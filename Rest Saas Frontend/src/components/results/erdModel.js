const tableId = table => table.schema ? `${table.schema}.${table.name}` : table.name;
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];

// Older Postgres snapshots can contain information_schema domain arrays as
// their wire-format string, e.g. {email} or {"tenant,id",email}.
export function columnNames(value) {
  if (Array.isArray(value)) return value.filter(name => typeof name === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  const input = value.trim();
  if (input.startsWith('[')) {
    try { const parsed = JSON.parse(input); return Array.isArray(parsed) ? columnNames(parsed) : []; } catch { return []; }
  }
  if (!input.startsWith('{') || !input.endsWith('}')) return [input];
  const names = [];
  let name = '', quoted = false, escaped = false, wasQuoted = false;
  const append = () => { if (name && (wasQuoted || name !== 'NULL')) names.push(name); name = ''; wasQuoted = false; };
  for (const char of input.slice(1, -1)) {
    if (escaped) { name += char; escaped = false; }
    else if (char === '\\') escaped = true;
    else if (char === '"') { quoted = !quoted; wasQuoted = true; }
    else if (char === ',' && !quoted) append();
    else name += char;
  }
  if (quoted || escaped) return [];
  append();
  return names;
}

export function buildERD(database = {}) {
  const tables = list(database?.tables).filter(table => typeof table.name === 'string' && table.name).map(table => ({ ...table, id: tableId(table), columns: list(table.columns).filter(column => typeof column.name === 'string'), primary_keys: columnNames(table.primary_keys), foreign_keys: list(table.foreign_keys), unique_constraints: list(table.unique_constraints).map(key => ({ ...key, columns: columnNames(key.columns) })) }));
  const byId = new Map(tables.map(table => [table.id, table]));
  const resolve = (schema, name) => {
    const exact = schema ? `${schema}.${name}` : name;
    if (byId.has(exact)) return exact;
    if (schema) return exact; // Never connect identically named tables across schemas.
    const matches = tables.filter(table => table.name === name);
    return matches.length === 1 ? matches[0].id : exact;
  };
  const relationships = [];
  const seen = new Set();
  const add = edge => {
    const key = JSON.stringify([edge.from, edge.fromColumn, edge.to, edge.toColumn]);
    if (seen.has(key)) return;
    seen.add(key);
    relationships.push({ ...edge, id: key, available: byId.has(edge.from) && byId.has(edge.to) });
  };
  for (const table of tables) for (const fk of table.foreign_keys) {
    if (!fk.references?.table) continue;
    add({ from: table.id, fromColumn: fk.column, to: resolve(fk.references.schema, fk.references.table), toColumn: fk.references.column, constraint: fk.constraint, onDelete: fk.on_delete });
  }
  for (const edge of list(database?.relationship_graph)) {
    add({ from: resolve(null, edge.from), fromColumn: edge.from_column, to: resolve(null, edge.to), toColumn: edge.to_column, onDelete: edge.on_delete });
  }
  return { tables, relationships };
}

export function layoutERD(model, query = '', keysOnly = false) {
  const match = query.trim().toLowerCase();
  const degree = id => model.relationships.filter(edge => edge.from === id || edge.to === id).length;
  const tables = model.tables.filter(table => !match || table.id.toLowerCase().includes(match)).sort((a, b) => degree(b.id) - degree(a.id) || a.id.localeCompare(b.id));
  const positions = Object.create(null);
  const cardWidth = 400, rowHeight = 30, header = 56, gap = 100, margin = 60;
  const entries = tables.map(table => {
    const keys = new Set([...table.primary_keys, ...table.foreign_keys.map(fk => fk.column), ...table.unique_constraints.flatMap(key => key.columns)]);
    for (const edge of model.relationships) {
      if (edge.from === table.id) keys.add(edge.fromColumn);
      if (edge.to === table.id) keys.add(edge.toColumn);
    }
    const columns = table.columns.filter(column => !keysOnly || keys.has(column.name));
    return { table, columns, height: header + Math.max(1, columns.length) * rowHeight + 12 };
  });
  const averageHeight = entries.reduce((sum, entry) => sum + entry.height, 0) / Math.max(1, entries.length);
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(entries.length * (averageHeight + gap) / (cardWidth + gap))));
  let y = margin;
  for (let index = 0; index < entries.length; index += columnCount) {
    const row = entries.slice(index, index + columnCount);
    const rowBottom = y + Math.max(...row.map(entry => entry.height));
    row.forEach((entry, column) => { positions[entry.table.id] = { ...entry, x: margin + column * (cardWidth + gap), y, width: cardWidth, column, rowBottom }; });
    y = rowBottom + gap;
  }
  const fieldY = (position, name) => {
    const index = position.columns.findIndex(column => column.name === name);
    return position.y + (index < 0 ? 28 : header + index * rowHeight + rowHeight / 2);
  };
  const edges = model.relationships.filter(edge => edge.available && positions[edge.from] && positions[edge.to]).map((edge, index) => {
    const from = positions[edge.from], to = positions[edge.to];
    const y1 = fieldY(from, edge.fromColumn), y2 = fieldY(to, edge.toColumn);
    const offset = 20 + index % 5 * 5;
    let d;
    if (from.column === to.column) {
      const x = from.x + cardWidth, lane = x + offset;
      d = `M${x} ${y1} H${lane} V${y2 === y1 ? y2 - 12 : y2} H${x}`;
    } else {
      const right = from.column < to.column;
      const x1 = from.x + (right ? cardWidth : 0), x2 = to.x + (right ? 0 : cardWidth);
      const lane1 = x1 + (right ? offset : -offset), lane2 = x2 + (right ? -offset : offset);
      if (from.y === to.y && Math.abs(from.column - to.column) === 1) {
        d = `M${x1} ${y1} H${(x1 + x2) / 2} V${y2} H${x2}`;
      } else {
        const laneY = from.rowBottom + offset;
        d = `M${x1} ${y1} H${lane1} V${laneY} H${lane2} V${y2} H${x2}`;
      }
    }
    return { ...edge, d };
  });
  return { positions, edges, width: Math.max(520, margin * 2 + columnCount * (cardWidth + gap) - gap), height: Math.max(200, y - gap + margin), rowHeight, header };
}

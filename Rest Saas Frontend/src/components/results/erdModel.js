const tableId = table => table.schema ? `${table.schema}.${table.name}` : table.name;

export function buildERD(database = {}) {
  const tables = (database.tables || []).map(table => ({ ...table, id: tableId(table), columns: table.columns || [], primary_keys: table.primary_keys || [], foreign_keys: table.foreign_keys || [], unique_constraints: table.unique_constraints || [] }));
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
  for (const edge of database.relationship_graph || []) {
    add({ from: resolve(null, edge.from), fromColumn: edge.from_column, to: resolve(null, edge.to), toColumn: edge.to_column, onDelete: edge.on_delete });
  }
  return { tables, relationships };
}

export function layoutERD(model, query = '', keysOnly = false) {
  const match = query.trim().toLowerCase();
  const degree = id => model.relationships.filter(edge => edge.from === id || edge.to === id).length;
  const tables = model.tables.filter(table => !match || table.id.toLowerCase().includes(match)).sort((a, b) => degree(b.id) - degree(a.id) || a.id.localeCompare(b.id));
  const positions = {};
  const width = 1080, cardWidth = 400, rowHeight = 30, header = 56;
  let y = 36;
  for (let index = 0; index < tables.length; index += 2) {
    let rowMax = 0;
    tables.slice(index, index + 2).forEach((table, column) => {
      const keyColumns = new Set([...table.primary_keys, ...table.foreign_keys.map(fk => fk.column), ...table.unique_constraints.flatMap(key => key.columns || [])]);
      for (const edge of model.relationships) {
        if (edge.from === table.id) keyColumns.add(edge.fromColumn);
        if (edge.to === table.id) keyColumns.add(edge.toColumn);
      }
      const columns = table.columns.filter(col => !keysOnly || keyColumns.has(col.name));
      const height = header + Math.max(1, columns.length) * rowHeight + 12;
      positions[table.id] = { table, columns, x: 50 + column * 580, y, width: cardWidth, height, column };
      rowMax = Math.max(rowMax, height);
    });
    y += rowMax + 72;
  }
  const fieldY = (position, name) => {
    const index = position.columns.findIndex(col => col.name === name);
    return position.y + (index < 0 ? 28 : header + index * rowHeight + rowHeight / 2);
  };
  const edges = model.relationships.filter(edge => edge.available && positions[edge.from] && positions[edge.to]).map((edge, index) => {
    const from = positions[edge.from], to = positions[edge.to];
    const y1 = fieldY(from, edge.fromColumn), y2 = fieldY(to, edge.toColumn);
    let x1, x2, mid;
    if (from.column === to.column) {
      const right = from.column === 1;
      x1 = from.x + (right ? cardWidth : 0);
      x2 = x1;
      mid = x1 + (right ? 1 : -1) * (18 + index % 4 * 7);
    } else {
      x1 = from.x + (from.column === 0 ? cardWidth : 0);
      x2 = to.x + (to.column === 0 ? cardWidth : 0);
      mid = 510 + index % 5 * 14;
    }
    // A self-reference returns to the same row by taking an outer loop.
    const d = edge.from === edge.to && y1 === y2
      ? `M${x1} ${y1} H${mid} V${y1 - 12} H${x2}`
      : `M${x1} ${y1} H${mid} V${y2} H${x2}`;
    return { ...edge, d };
  });
  return { positions, edges, width, height: Math.max(200, y - 30), rowHeight, header };
}

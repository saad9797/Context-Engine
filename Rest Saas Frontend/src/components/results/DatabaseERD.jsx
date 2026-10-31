import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, InputAdornment, List, ListItemButton, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { buildERD, layoutERD, searchERD } from './erdModel';
import { downloadDiagram } from './diagramTools';
import useDiagramCanvas from './useDiagramCanvas';

const shorten = (value, length) => String(value || '').length > length ? `${String(value).slice(0, length - 1)}…` : String(value || '');
const accents = ['#617f9c', '#7c759d', '#5f8c7a', '#ac8053', '#8c7090'];

export default function DatabaseERD({ database }) {
  const theme = useTheme();
  const svg = useRef(null), search = useRef(null), pendingFocus = useRef(null);
  const marker = useId().replace(/:/g, '');
  const [query, setQuery] = useState('');
  const [detailChoice, setDetail] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [selected, setSelected] = useState(null);
  const [selectedColumn, setSelectedColumn] = useState(null);
  const [relatedOnly, setRelatedOnly] = useState(false);
  const [aspect, setAspect] = useState(1.5);
  const model = useMemo(() => buildERD(database), [database]);
  const detail = detailChoice || (model.tables.length > 12 ? 'keys' : 'all');
  const results = useMemo(() => searchERD(model, query), [model, query]);
  const resultIds = useMemo(() => new Set(results.map(result => result.table.id)), [results]);
  const relatedIds = useMemo(() => new Set([selected, ...model.relationships.filter(edge => edge.from === selected || edge.to === selected).flatMap(edge => [edge.from, edge.to])]), [model, selected]);
  const visibleModel = useMemo(() => relatedOnly && selected ? { ...model, tables: model.tables.filter(table => relatedIds.has(table.id)) } : model, [model, relatedOnly, selected, relatedIds]);
  const layout = useMemo(() => layoutERD(visibleModel, '', detail === 'keys', { detail, aspectRatio: aspect }), [visibleModel, detail, aspect]);
  const canvas = useDiagramCanvas(layout.width, layout.height);
  const missing = model.relationships.filter(edge => !edge.available);
  const selectedTable = model.tables.find(table => table.id === selected);
  const activeEdges = model.relationships.filter(edge => edge.available && (edge.from === selected || edge.to === selected));
  const schemas = [...new Set(model.tables.map(table => table.schema || 'default'))].sort();
  const tableColor = table => accents[schemas.indexOf(table.schema || 'default') % accents.length];
  const color = theme.palette.primary.main, text = theme.palette.text.primary, muted = theme.palette.text.secondary;
  useEffect(() => { setAspect(Math.round(canvas.viewport.width / canvas.viewport.height * 100) / 100); }, [canvas.viewport]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    const position = layout.positions[pendingFocus.current];
    if (position) { canvas.focus(position); pendingFocus.current = null; }
  }, [layout, canvas.focus]);
  function inspect(id, column = null, navigate = false) {
    setSelected(id); setSelectedColumn(column);
    if (navigate) {
      setRelatedOnly(false);
      if (relatedOnly || column && detail !== 'all') { pendingFocus.current = id; if (column) setDetail('all'); }
      else if (layout.positions[id]) canvas.focus(layout.positions[id]);
    }
  }
  function showAll() { setQuery(''); setSelected(null); setSelectedColumn(null); setRelatedOnly(false); canvas.fit(); }
  const inspector = (selectedTable && <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, maxHeight: 290, overflow: 'auto', flexShrink: 0 }} aria-label="Table inspector">
      <Stack direction="row" useFlexGap sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}><Typography variant="subtitle2">{selectedTable.id}</Typography><Typography variant="caption" color="text.secondary">{selectedTable.columns.length} fields / {activeEdges.length} declared references</Typography></Box>
        <Stack direction="row" spacing={.5} useFlexGap sx={{ flexWrap: 'wrap', width: '100%' }}><Button size="small" onClick={() => canvas.focus(layout.positions[selected] || { x: 0, y: 0, width: layout.width, height: layout.height })}>Locate table</Button><Button size="small" aria-pressed={relatedOnly} onClick={() => setRelatedOnly(value => !value)}>{relatedOnly ? 'Show full database' : 'Focus related tables'}</Button><IconButton size="small" aria-label="Close table inspector" onClick={() => { setSelected(null); setSelectedColumn(null); setRelatedOnly(false); }}><CloseIcon fontSize="small" /></IconButton></Stack>
      </Stack>
      {selectedColumn && <Box sx={{ mt: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}><Typography variant="body2"><strong>{selectedColumn}</strong> / {selectedTable.columns.find(column => column.name === selectedColumn)?.type}</Typography>{selectedTable.columns.filter(column => column.name === selectedColumn).map(column => <Typography key={column.name} variant="caption" color="text.secondary">{column.comment || ''}{column.default != null ? ` Default: ${column.default}` : ''}</Typography>)}</Box>}
      <Typography variant="subtitle2" sx={{ mt: 1 }}>Explain selected relationships ({activeEdges.length})</Typography>
      {!activeEdges.length && <Typography variant="body2" color="text.secondary">No declared foreign-key relationships were captured for this table.</Typography>}
      <Stack spacing={.25} sx={{ maxHeight: 160, overflow: 'auto' }}>{activeEdges.map(edge => {
        const target = edge.from === selected ? edge.to : edge.from, field = edge.from === selected ? edge.fromColumn : edge.toColumn;
        return <Button key={edge.id} size="small" onClick={() => inspect(target, edge.from === selected ? edge.toColumn : edge.fromColumn, true)} sx={{ justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', overflowWrap: 'anywhere' }}>{field} → {target}{edge.onDelete ? ` / On delete: ${edge.onDelete}` : ''}</Button>;
      })}</Stack>
    </Paper>);
  if (!database || !model.tables.length) return <Alert severity="info">No relational database tables were captured. Connect PostgreSQL or MySQL and build a snapshot to generate an ERD. MongoDB collections are available in the system overview and technical diagram.</Alert>;

  return <Box onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setSidebar(true); setTimeout(() => search.current?.focus(), 0); }
    if (event.key === 'Escape') { if (query) setQuery(''); else setExpanded(false); }
  }} sx={expanded ? { position: 'fixed', inset: 0, zIndex: 1400, bgcolor: 'background.default', p: { xs: 1, md: 2 }, overflow: 'auto' } : {}}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
      <Box><Typography variant="h6">Database Entity Relationship Diagram</Typography><Typography variant="caption" color="text.secondary">{model.tables.length} tables / {model.relationships.length} relationships. Explore a table to understand how it connects.</Typography></Box>
      <Stack direction="row" spacing={1}><Button size="small" onClick={() => setSidebar(value => !value)}>{sidebar ? 'Hide explorer' : 'Show explorer'}</Button><Button size="small" onClick={() => setExpanded(value => !value)}>{expanded ? 'Exit expanded view' : 'Expand board'}</Button></Stack>
    </Stack>
    <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, p: 1, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
        <Stack direction="row" spacing={.5} sx={{ alignItems: 'center' }}>
          <ToggleButtonGroup size="small" exclusive value={detail} aria-label="Diagram detail level" onChange={(_, value) => { if (value) setDetail(value); }}>
            <ToggleButton value="overview">Tables</ToggleButton><ToggleButton value="keys" aria-label="Keys only">Keys only</ToggleButton><ToggleButton value="all">All fields</ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title="Return to the complete database" describeChild><Button size="small" onClick={showAll} startIcon={<CenterFocusStrongIcon fontSize="small" />}>Fit all tables</Button></Tooltip>
        </Stack>
        <Stack direction="row" spacing={.25} sx={{ alignItems: 'center' }}>
          <Button size="small" aria-label="Zoom ERD out" onClick={() => canvas.zoom(.8)} sx={{ minWidth: 30 }}>−</Button>
          <Button size="small" aria-label="Reset ERD zoom" onClick={() => canvas.zoom(1 / canvas.camera.scale)}>{Math.round(canvas.camera.scale * 100)}%</Button>
          <Button size="small" aria-label="Zoom ERD in" onClick={() => canvas.zoom(1.25)} sx={{ minWidth: 30 }}>+</Button>
          <Button size="small" onClick={() => downloadDiagram(svg.current, 'database-erd.svg', { width: layout.width, height: layout.height })}>Export ERD SVG</Button>
        </Stack>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: sidebar ? '236px minmax(0,1fr)' : 'minmax(0,1fr)' } }}>
        {sidebar && <Box component="aside" aria-label="Schema explorer" sx={{ minWidth: 0, overflow: 'hidden', borderRight: { md: 1 }, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', height: { xs: selectedTable ? 440 : 230, md: expanded ? 'calc(100vh - 152px)' : 660 } }}>
          <Box sx={{ p: 1.25 }}>
            <TextField inputRef={search} size="small" fullWidth label="Search schema" placeholder="Tables, columns, types…" value={query} onChange={event => { setQuery(event.target.value); setSelected(null); setSelectedColumn(null); setRelatedOnly(false); }} onKeyDown={event => { if (event.key === 'Enter' && results[0]) { event.preventDefault(); inspect(results[0].table.id, results[0].matches[0]?.name || null, true); } }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>, endAdornment: query ? <InputAdornment position="end"><IconButton size="small" aria-label="Clear schema search" onClick={() => setQuery('')}><CloseIcon fontSize="small" /></IconButton></InputAdornment> : undefined } }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{query ? `${results.length} matching tables` : 'TABLES'} <Box component="span" sx={{ float: 'right' }}>{query ? 'Enter to explore' : 'Click to explore'}</Box></Typography>
          </Box>
          <List dense disablePadding aria-label="Schema search results" sx={{ flex: 1, overflowY: 'auto', minHeight: 50, px: .5 }}>
            {results.map(({ table, matches, tableMatch }) => <Box key={table.id}>
              <ListItemButton selected={selected === table.id} onClick={() => inspect(table.id, query && !tableMatch ? matches[0]?.name : null, true)} aria-label={`Explore table ${table.id}`} sx={{ borderRadius: 1, py: .8, gap: 1, alignItems: 'flex-start' }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: tableColor(table), mt: .8, flexShrink: 0 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}><Typography variant="body2" noWrap title={table.id} sx={{ fontWeight: 600 }}>{table.name}</Typography><Typography variant="caption" color="text.secondary">{table.schema || 'default'} / {table.columns.length} fields</Typography></Box>
              </ListItemButton>
              {query && matches.slice(0, 4).map(column => <ListItemButton key={column.name} aria-label={`Explore column ${table.id}.${column.name}`} onClick={() => inspect(table.id, column.name, true)} sx={{ pl: 3.5, py: .3, borderRadius: 1 }}><Typography variant="caption" noWrap title={`${column.name}: ${column.type || column.udt || ''}`} sx={{ color: selected === table.id && selectedColumn === column.name ? 'primary.main' : 'text.secondary' }}>{column.name} <Box component="span" sx={{ opacity: .7 }}>{column.type || column.udt}</Box></Typography></ListItemButton>)}
            </Box>)}
            {!results.length && <Box sx={{ p: 1.5 }}><Typography variant="body2">No schema matches.</Typography><Button size="small" onClick={() => setQuery('')}>Clear search</Button></Box>}
          </List>
          {inspector}
          <Typography variant="caption" color="text.secondary" sx={{ p: 1.25, borderTop: 1, borderColor: 'divider' }}>Search names, types, defaults and notes. Row values are not stored in this snapshot.</Typography>
        </Box>}
        <Box sx={{ minWidth: 0, position: 'relative' }}>
          <Box ref={canvas.container} {...canvas.handlers} tabIndex={0} aria-label="Interactive database diagram canvas" sx={{ position: 'relative', overflow: 'hidden', height: expanded ? 'calc(100vh - 152px)' : 660, minHeight: 440, bgcolor: 'action.hover', touchAction: 'none', cursor: canvas.panning ? 'grabbing' : 'grab', backgroundImage: `radial-gradient(${theme.palette.divider} .7px, transparent .7px)`, backgroundSize: '18px 18px' }}>
            <svg ref={svg} role="group" aria-label="Database tables, fields, keys and declared foreign key relationships" viewBox={canvas.viewBox} width="100%" height="100%" preserveAspectRatio="none" style={{ display: 'block', fontFamily: theme.typography.fontFamily }}>
              <title>Database Entity Relationship Diagram</title>
              <style>{`.erd-table:focus { outline: none; } .erd-table:focus-visible > rect:first-of-type { stroke: ${text}; stroke-width: 3px; }`}</style>
              <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill={color} /></marker></defs>
              {layout.edges.map(edge => <g key={edge.id} opacity={selected ? (edge.from === selected || edge.to === selected ? .9 : .07) : .32}><title>{edge.from}.{edge.fromColumn} references {edge.to}.{edge.toColumn}</title><path d={edge.d} stroke={color} strokeWidth={selected ? 1.7 : 1.2} strokeLinejoin="round" fill="none" markerEnd={`url(#${marker})`} /></g>)}
              {Object.values(layout.positions).map(({ table, columns, x, y, width, height }) => {
                const foreignColumns = new Set(model.relationships.filter(edge => edge.from === table.id).map(edge => edge.fromColumn));
                const related = !selected || relatedIds.has(table.id), searchMatch = !query || resultIds.has(table.id), accent = tableColor(table);
                return <g key={table.id} transform={`translate(${x},${y})`} className="erd-table" role="button" tabIndex="0" aria-label={`Focus table ${table.id}`} aria-pressed={selected === table.id} onClick={event => { event.stopPropagation(); if (!canvas.dragged.current) inspect(table.id); }} onDoubleClick={() => inspect(table.id, null, true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(table.id, null, true); } }} style={{ cursor: 'pointer', opacity: searchMatch && related ? 1 : .2 }}>
                  <title>{table.id} / {table.columns.length} columns</title>
                  <rect width={width} height={height} rx="8" fill={theme.palette.background.paper} stroke={selected === table.id || query && resultIds.has(table.id) ? accent : theme.palette.divider} strokeWidth={selected === table.id ? 2 : 1} />
                  <rect x="1" y="1" width={width - 2} height="47" rx="7" fill={accent} opacity=".08" />
                  <rect x="0" y="8" width="3" height="30" rx="1.5" fill={accent} />
                  <text x="13" y="21" fontSize="13" fontWeight="650" fill={text}>{shorten(table.name, 42)}</text>
                  <text x="13" y="38" fontSize="10" fill={muted}>{shorten(table.schema || 'default', 25)} / {table.columns.length} fields</text>
                  {columns.map((column, index) => {
                    const cy = layout.header + index * layout.rowHeight;
                    const tags = [table.primary_keys.includes(column.name) && 'PK', foreignColumns.has(column.name) && 'FK'].filter(Boolean).join(' ');
                    const unique = table.unique_constraints.filter(key => key.columns.includes(column.name));
                    const highlighted = selected === table.id && selectedColumn === column.name || query && results.find(result => result.table.id === table.id)?.matches.some(match => match.name === column.name);
                    return <g key={column.name}>
                      <title>{column.name}: {column.type || column.udt || 'type unavailable'} / {column.nullable === true ? 'nullable' : column.nullable === false ? 'required' : 'nullability unavailable'}{unique.length ? ` / unique constraints: ${unique.map(key => key.columns.join(' + ')).join('; ')}` : ''}</title>
                      {highlighted && <rect x="1" y={cy} width={width - 2} height={layout.rowHeight} fill={color} opacity=".13" />}
                      <line x1="10" x2={width - 10} y1={cy + layout.rowHeight} y2={cy + layout.rowHeight} stroke={theme.palette.divider} opacity=".4" />
                      <text x="12" y={cy + 17} fontSize="9" fontWeight="700" fill={accent}>{tags}</text>
                      <text x="60" y={cy + 17} fontSize="11.5" fill={text}>{shorten(column.name, 25)}</text>
                      <text x="245" y={cy + 17} fontSize="10" fill={muted}>{shorten(column.type || column.udt || '?', 15)}</text>
                      <text x="347" y={cy + 17} textAnchor="end" fontSize="11" fill={muted}>{column.nullable === true ? '?' : ''}</text>
                    </g>;
                  })}
                  {!columns.length && detail !== 'overview' && <text x="13" y={layout.header + 18} fontSize="11" fill={muted}>{detail === 'keys' ? 'No key fields captured' : 'No columns captured'}</text>}
                </g>;
              })}
            </svg>
            <Box onPointerDown={event => event.stopPropagation()} sx={{ position: 'absolute', bottom: 12, right: 12, width: 116, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1.5, p: .5, boxShadow: 1 }}>
              <svg role="button" tabIndex={0} aria-label="Database overview minimap" viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" height="76" onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); canvas.fit(); } }} onClick={event => {
                const bounds = event.currentTarget.getBoundingClientRect(), scale = Math.min(bounds.width / layout.width, bounds.height / layout.height);
                const left = (bounds.width - layout.width * scale) / 2, top = (bounds.height - layout.height * scale) / 2;
                if (scale > 0) canvas.center({ x: (event.clientX - bounds.left - left) / scale, y: (event.clientY - bounds.top - top) / scale });
              }} style={{ display: 'block', cursor: 'crosshair' }}><title>All tables. Click to navigate; Enter fits all.</title>{Object.values(layout.positions).map(position => <rect key={position.table.id} x={position.x} y={position.y} width={position.width} height={position.height} rx="6" fill={tableColor(position.table)} opacity={selected === position.table.id ? 1 : .4} />)}<rect x={canvas.camera.x} y={canvas.camera.y} width={canvas.viewport.width / canvas.camera.scale} height={canvas.viewport.height / canvas.camera.scale} fill={color} fillOpacity=".05" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', bottom: 10, left: 12, pointerEvents: 'none', bgcolor: 'background.paper', borderRadius: 1, px: .75 }}>Drag to pan / Scroll to zoom / Double-click a table to focus</Typography>
            {!sidebar && selectedTable && <Box sx={{ position: 'absolute', top: 12, left: 12, width: 300, maxWidth: '85%' }}>{inspector}</Box>}
            {query && !results.length && <Alert severity="info" sx={{ position: 'absolute', top: 12, left: 12 }}>No tables match your search. The full diagram remains in place.</Alert>}
          </Box>
        </Box>
      </Box>
      <Stack direction="row" useFlexGap sx={{ px: 1.5, py: .75, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">{Object.keys(layout.positions).length} of {model.tables.length} tables / {layout.edges.length} of {model.relationships.length} field relationships shown</Typography>
        <Typography variant="caption" color="text.secondary">PK identifies a record / FK links a record / ? can be empty</Typography>
      </Stack>
    </Paper>

    {!!missing.length && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{missing.length} references point outside this snapshot.</Typography>}
    {!model.relationships.length && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>No declared foreign keys were captured. Tables are shown without inferred relationships.</Typography>}
  </Box>;
}

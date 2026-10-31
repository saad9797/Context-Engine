import React, { useId, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Paper, Stack, TextField, Typography, useTheme } from '@mui/material';
import { buildERD, layoutERD } from './erdModel';
import { downloadDiagram } from './diagramTools';
import useDiagramCanvas from './useDiagramCanvas';

const shorten = (value, length) => String(value || '').length > length ? `${String(value).slice(0, length - 1)}…` : String(value || '');

export default function DatabaseERD({ database }) {
  const theme = useTheme();
  const svg = useRef(null);
  const marker = useId().replace(/:/g, '');
  const [query, setQuery] = useState('');
  const [keysOnly, setKeysOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(null);
  const model = useMemo(() => buildERD(database), [database]);
  const layout = useMemo(() => layoutERD(model, query, keysOnly), [model, query, keysOnly]);
  const canvas = useDiagramCanvas(layout.width, layout.height);
  const missing = model.relationships.filter(edge => !edge.available);
  const color = theme.palette.primary.main;
  const text = theme.palette.text.primary;
  const muted = theme.palette.text.secondary;
  if (!database || !model.tables.length) return <Alert severity="info">No relational database tables were captured. Connect PostgreSQL or MySQL and build a snapshot to generate an ERD. MongoDB collections are available in the system overview and technical diagram.</Alert>;
  const activeEdges = selected ? layout.edges.filter(edge => edge.from === selected || edge.to === selected) : layout.edges;
  return <Box onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }} sx={expanded ? { position: 'fixed', inset: 0, zIndex: 1400, bgcolor: 'background.default', p: { xs: 1.5, md: 3 }, overflow: 'auto' } : {}}>
    <Typography variant="h6" sx={{ mb: 1 }}>Database Entity Relationship Diagram</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Each card is a table. Arrows connect a foreign key to the exact field it references. All tables share one board. Drag to pan, scroll or pinch to zoom, and select a table to focus its relationships.</Typography>
    <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
      <TextField size="small" label="Find a table" value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} />
      <FormControlLabel control={<Checkbox checked={keysOnly} onChange={event => setKeysOnly(event.target.checked)} />} label="Keys only" />
      <Button aria-label="Zoom ERD out" disabled={canvas.camera.scale <= .01} onClick={() => canvas.zoom(.8)}>−</Button>
      <Button onClick={() => canvas.zoom(1 / canvas.camera.scale)} aria-label="Reset ERD zoom">{Math.round(canvas.camera.scale * 100)}%</Button>
      <Button aria-label="Zoom ERD in" disabled={canvas.camera.scale >= 3} onClick={() => canvas.zoom(1.25)}>+</Button>
      <Button onClick={() => { setQuery(''); setSelected(null); canvas.fit(); }}>Fit all tables</Button>
      <Button onClick={() => setExpanded(value => !value)}>{expanded ? 'Exit expanded view' : 'Expand board'}</Button>
      <Button onClick={() => downloadDiagram(svg.current, 'database-erd.svg', { width: layout.width, height: layout.height })}>Export ERD SVG</Button>
      {selected && <Button onClick={() => setSelected(null)}>Show all relationships</Button>}
    </Stack>
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{Object.keys(layout.positions).length} of {model.tables.length} tables · {layout.edges.length} of {model.relationships.length} field relationships shown</Typography>
    {!Object.keys(layout.positions).length ? <Alert severity="info">No tables match “{query}”. Clear the search to see the full ERD.</Alert> : <Paper ref={canvas.container} {...canvas.handlers} variant="outlined" tabIndex={0} aria-label="Interactive database diagram canvas" sx={{ position: 'relative', overflow: 'hidden', height: expanded ? 'calc(100vh - 230px)' : '65vh', minHeight: 400, maxHeight: expanded ? 'none' : 740, bgcolor: 'action.hover', touchAction: 'none', cursor: canvas.panning ? 'grabbing' : 'grab', backgroundImage: `radial-gradient(${theme.palette.divider} 1px, transparent 1px)`, backgroundSize: '20px 20px' }}>
      <svg ref={svg} role="group" aria-label="Database tables, fields, keys and declared foreign key relationships" viewBox={canvas.viewBox} width="100%" height="100%" preserveAspectRatio="none" style={{ display: 'block', fontFamily: theme.typography.fontFamily }}>
        <title>Database Entity Relationship Diagram</title>
        <style>{`.erd-table:focus { outline: none; } .erd-table:focus-visible > rect:first-of-type { stroke: ${text}; stroke-width: 3px; }`}</style>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill={color} /></marker></defs>
        {layout.edges.map(edge => <g key={edge.id} opacity={selected ? (edge.from === selected || edge.to === selected ? 1 : .08) : .45}>
          <title>{edge.from}.{edge.fromColumn} references {edge.to}.{edge.toColumn}{edge.constraint ? ` (${edge.constraint})` : ''}</title>
          <path d={edge.d} stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill="none" markerEnd={`url(#${marker})`} />
        </g>)}
        {Object.values(layout.positions).map(({ table, columns, x, y, width, height }) => {
          const foreignColumns = new Set(model.relationships.filter(edge => edge.from === table.id).map(edge => edge.fromColumn));
          const related = !selected || table.id === selected || activeEdges.some(edge => edge.from === table.id || edge.to === table.id);
          return <g key={table.id} transform={`translate(${x},${y})`} className="erd-table" role="button" tabIndex="0" aria-label={`Focus table ${table.id}`} aria-pressed={selected === table.id} onClick={event => { event.stopPropagation(); if (!canvas.dragged.current) setSelected(table.id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(table.id); } }} style={{ cursor: 'pointer', opacity: related ? 1 : .3 }}>
            <title>{table.id} · {table.columns.length} columns</title>
            <rect width={width} height={height} rx="12" fill={theme.palette.background.paper} stroke={selected === table.id ? color : theme.palette.divider} strokeWidth={selected === table.id ? 2 : 1} />
            <rect x="1" y="1" width={width - 2} height="52" rx="11" fill={color} opacity=".08" />
            <text x="16" y="24" fontSize="14" fontWeight="600" fill={text}>{shorten(table.id, 44)}</text>
            <text x="16" y="43" fontSize="10.5" fill={muted}>{table.columns.length} fields · {table.primary_keys.length ? `${table.primary_keys.length} primary key field(s)` : 'No primary key captured'}</text>
            {columns.map((column, index) => {
              const cy = layout.header + index * layout.rowHeight;
              const tags = [table.primary_keys.includes(column.name) && 'PK', foreignColumns.has(column.name) && 'FK'].filter(Boolean).join(' ');
              const unique = table.unique_constraints.filter(key => key.columns?.includes(column.name));
              return <g key={column.name}>
                <title>{column.name}: {column.type || column.udt || 'type unavailable'} · {column.nullable === true ? 'nullable' : column.nullable === false ? 'required' : 'nullability unavailable'}{unique.length ? ` · unique constraints: ${unique.map(key => (key.columns || []).join(' + ')).join('; ')}` : ''}</title>
                <line x1="12" x2={width - 12} y1={cy + layout.rowHeight} y2={cy + layout.rowHeight} stroke={theme.palette.divider} opacity=".6" />
                <text x="14" y={cy + 20} fontSize="10" fontWeight="700" fill={color}>{tags}</text>
                <text x="65" y={cy + 20} fontSize="12" fill={text}>{shorten(column.name, 27)}</text>
                <text x="265" y={cy + 20} fontSize="11" fill={muted}>{shorten(column.type || column.udt || '?', 16)}</text>
                <text x="383" y={cy + 20} textAnchor="end" fontSize="12" fill={muted}>{column.nullable === true ? '?' : ''}</text>
              </g>;
            })}
            {!columns.length && <text x="16" y={layout.header + 22} fontSize="12" fill={muted}>{keysOnly ? 'No key fields captured' : 'No columns captured'}</text>}
          </g>;
        })}
      </svg>
      <Box onPointerDown={event => event.stopPropagation()} sx={{ position: 'absolute', bottom: 14, right: 14, width: 160, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, p: 1, boxShadow: 2 }}>
        <Typography variant="caption" color="text.secondary">Overview · click to navigate</Typography>
        <svg role="button" tabIndex={0} aria-label="Database overview minimap" viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" height="100" style={{ display: 'block', cursor: 'crosshair' }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); canvas.fit(); } }} onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const scale = Math.min(bounds.width / layout.width, bounds.height / layout.height);
          const left = (bounds.width - layout.width * scale) / 2, top = (bounds.height - layout.height * scale) / 2;
          if (scale > 0) canvas.center({ x: (event.clientX - bounds.left - left) / scale, y: (event.clientY - bounds.top - top) / scale });
        }}>
          <title>All tables and the current viewport. Click to navigate; Enter fits all tables.</title>
          {Object.values(layout.positions).map(position => <rect key={position.table.id} x={position.x} y={position.y} width={position.width} height={position.height} rx="8" fill={color} opacity={selected === position.table.id ? 1 : .3} />)}
          <rect x={canvas.camera.x} y={canvas.camera.y} width={canvas.viewport.width / canvas.camera.scale} height={canvas.viewport.height / canvas.camera.scale} fill={color} fillOpacity=".06" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </Box>
    </Paper>}
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>Drag to pan | Scroll / pinch to zoom | F to fit | + / - to zoom | Arrow keys to pan. PK = primary key (identifies a record) · FK = foreign key (points to another record) · ? = can be empty. Composite keys may use several fields together. Relationship arrows show declared references; they do not imply one-to-one cardinality.</Typography>
    {!!missing.length && <Alert severity="warning" sx={{ mt: 2 }}>{missing.length} reference(s) point to tables outside this snapshot. They are not drawn as captured tables.</Alert>}
    {!model.relationships.length && <Alert severity="info" sx={{ mt: 2 }}>No declared foreign keys were captured. Tables are shown without inferred relationships.</Alert>}
    {!!activeEdges.length && <Box component="details" sx={{ mt: 2 }}>
      <Typography component="summary" variant="subtitle2">Explain {selected ? 'selected' : 'database'} relationships ({activeEdges.length})</Typography>
      <Box component="ul" sx={{ pl: 3, maxHeight: 260, overflow: 'auto' }}>{activeEdges.map(edge => <Typography key={edge.id} component="li" variant="body2" sx={{ my: 1 }}><strong>{edge.from}.{edge.fromColumn}</strong> points to <strong>{edge.to}.{edge.toColumn}</strong>{edge.onDelete ? ` · On delete: ${edge.onDelete}` : ''}.</Typography>)}</Box>
    </Box>}
  </Box>;
}

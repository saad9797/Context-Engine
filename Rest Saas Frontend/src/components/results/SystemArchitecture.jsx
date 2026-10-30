import React, { useId, useRef, useState } from 'react';
import { Box, Button, Chip, Paper, Stack, Typography, useTheme } from '@mui/material';
import { downloadDiagram } from './diagramTools';

export function systemSources(data = {}) {
  const sources = [];
  if (data.database) sources.push({ id: 'database', name: data.database.dialect === 'mysql' ? 'MySQL database' : 'PostgreSQL database', detail: 'Stores structured information', action: 'Reads and saves data', explanation: 'Organizes information into tables, like connected spreadsheets. The application uses it to find and update records.', count: `${data.database.tables?.length || 0} tables captured`, tone: '#5681bd' });
  if (data.mongo_database) sources.push({ id: 'mongo', name: 'MongoDB database', detail: 'Stores flexible documents', action: 'Reads and saves documents', explanation: 'Keeps information in flexible documents. Different documents can hold different fields, which is useful for changing or nested information.', count: `${data.mongo_database.collections?.length || 0} collections captured`, tone: '#4b976b' });
  if (data.object_storage) {
    const provider = data.object_storage.provider;
    const name = { 'aws-s3': 'AWS S3 storage', 'azure-blob': 'Azure Blob storage', 's3-compatible': 'S3-compatible storage' }[provider] || 'Cloud file storage';
    sources.push({ id: 'storage', name, detail: 'Stores files, images, and uploads', action: 'Uploads and retrieves files', explanation: 'Keeps larger files outside the database. The application retrieves or uploads the files; database records may keep a reference to them. This storage source does not identify where the application is hosted.', count: `${(data.object_storage.containers || data.object_storage.buckets || []).length} storage containers captured`, tone: provider === 'azure-blob' ? '#3189bf' : '#bb863d', provider });
  }
  return sources;
}

function SourceIcon({ kind, provider }) {
  if (kind === 'server') return <><rect x="4" y="5" width="32" height="13" rx="3" /><rect x="4" y="23" width="32" height="13" rx="3" /><path d="M10 11h1m5 0h12M10 29h1m5 0h12" /></>;
  if (kind === 'mongo') return <><path d="M20 3C3 15 8 28 20 34C32 28 37 15 20 3Z" /><path d="M20 12v27m0-13-6-7m6 1 6-6" /></>;
  if (kind === 'storage' && provider === 'azure-blob') return <path d="m18 5-14 30h12l4-9h12L24 5Zm2 21 6 9h11L24 5" />;
  if (kind === 'storage') return <><path d="M10 29H8a7 7 0 0 1-1-14 11 11 0 0 1 21-3 9 9 0 0 1 4 17h-2" /><path d="M20 20v17m-6-11 6-6 6 6" /></>;
  return <><ellipse cx="20" cy="8" rx="15" ry="5" /><path d="M5 8v23c0 7 30 7 30 0V8M5 19c0 7 30 7 30 0" /></>;
}

export default function SystemArchitecture({ data = {}, compact = false }) {
  const theme = useTheme();
  const marker = useId().replace(/:/g, '');
  const svg = useRef(null);
  const [motion, setMotion] = useState(true);
  const [selection, setSelection] = useState(null);
  const sources = systemSources(data);
  const hasCode = Boolean(data.codebase);
  const server = { id: 'server', name: 'Application server', detail: 'Runs your project codebase', tone: theme.palette.primary.main, explanation: 'Runs the rules and features written in your codebase. It processes requests and coordinates work with the project’s data sources.', count: data.codebase?.repository?.full_name || 'Codebase captured' };
  const components = [...(hasCode ? [server] : []), ...sources];
  const selected = components.find(source => source.id === selection) || components[0];
  const height = Math.max(250, sources.length * 150 + 70);
  const center = height / 2;
  const color = theme.palette.primary.main;
  const text = theme.palette.text.primary;
  const muted = theme.palette.text.secondary;
  const card = (x, y, source) => <g transform={`translate(${x}, ${y})`} role="button" tabIndex="0" aria-label={`Explain ${source.name}`} aria-pressed={selected?.id === source.id} onClick={() => setSelection(source.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection(source.id); } }} style={{ cursor: 'pointer' }} className="system-card">
    <title>{source.name}: {source.detail}</title>
    <rect width="290" height="96" rx="16" fill={theme.palette.background.paper} stroke={selected?.id === source.id ? source.tone : theme.palette.divider} strokeWidth={selected?.id === source.id ? 2 : 1} />
    <rect x="14" y="22" width="52" height="52" rx="14" fill={source.tone} opacity="0.1" />
    <g transform="translate(20, 28)"><g className="source-icon" fill="none" stroke={source.tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><SourceIcon kind={source.id} provider={source.provider} /></g></g>
    <text x="78" y="39" fill={text} fontSize="16" fontWeight="600">{source.name}</text>
    <text x="78" y="64" fill={muted} fontSize="11.5">{source.detail}</text>
  </g>;
  return <Box>
    <Stack direction="row" useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1 }}>
      <Typography variant={compact ? 'subtitle2' : 'h6'}>System Design Architecture Diagram</Typography>
      <Stack direction="row" spacing={1}>
        <Button size="small" aria-pressed={!motion} onClick={() => setMotion(value => !value)}>{motion ? 'Pause motion' : 'Resume motion'}</Button>
        {!compact && <Button size="small" onClick={() => downloadDiagram(svg.current, 'system-architecture.svg')}>Export SVG</Button>}
      </Stack>
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      {hasCode ? 'Follow how the application works with each data source. Select a component to explain its role.' : 'Data sources found in this snapshot. Add a codebase to show the application server.'}
    </Typography>
    <Paper variant="outlined" sx={{ p: 1.5, overflowX: 'auto', backgroundImage: `radial-gradient(${theme.palette.divider} 1px, transparent 1px)`, backgroundSize: '18px 18px' }}>
      <svg ref={svg} role="group" aria-label="System architecture showing the application and available databases and cloud storage" viewBox={`0 0 940 ${height}`} className={motion ? '' : 'motion-paused'} style={{ display: 'block', width: '100%', minWidth: compact ? 560 : 680, fontFamily: theme.typography.fontFamily }}>
        <title>System Design Architecture Diagram</title>
        <style>{`
          @keyframes source-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
          @keyframes source-flow { to { stroke-dashoffset: -48; } }
          .source-icon { animation: source-float 4s ease-in-out infinite; }
          .source-flow { animation: source-flow 3s linear infinite; }
          .motion-paused .source-icon,.motion-paused .source-flow { animation-play-state: paused; }
          .system-card:focus { outline: none; }
          .system-card:focus-visible > rect:first-of-type { stroke: ${text}; stroke-width: 3px; }
          @media (prefers-reduced-motion: reduce) { .source-icon,.source-flow { animation: none; } }
        `}</style>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill={color} /></marker></defs>
        <text x={hasCode ? 30 : 325} y="26" fontSize="11" fontWeight="600" fill={muted}>{hasCode ? 'APPLICATION LAYER' : 'CAPTURED DATA SOURCES'}</text>
        {hasCode && sources.length > 0 && <text x="620" y="26" fontSize="11" fontWeight="600" fill={muted}>DATA &amp; FILE STORAGE</text>}
        {hasCode && sources.map((source, index) => {
          const y = 50 + index * 150 + 48;
          return <g key={source.id}>
            <path className="source-flow" d={`M325 ${center} C460 ${center}, 460 ${y}, 610 ${y}`} fill="none" stroke={color} strokeWidth="2" strokeDasharray="6 6" markerEnd={`url(#${marker})`} />
            <rect x="345" y={y - 32} width="250" height="24" rx="6" fill={theme.palette.background.paper} />
            <text x="470" y={y - 16} textAnchor="middle" fill={muted} fontSize="12">{source.action}</text>
          </g>;
        })}
        {hasCode && card(30, center - 48, server)}
        {sources.map((source, index) => <React.Fragment key={source.id}>{card(hasCode ? 620 : 325, 50 + index * 150, source)}</React.Fragment>)}
        {!sources.length && <text x={hasCode ? 560 : 80} y={center} fill={muted} fontSize="14">No data sources in this snapshot</text>}
      </svg>
    </Paper>
    {selected && <Paper variant="outlined" aria-live="polite" sx={{ p: 2, mt: 1.5, borderLeft: `3px solid ${selected.tone}` }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: 'center', mb: .75 }}><Typography variant="subtitle2">What this part does</Typography><Chip size="small" variant="outlined" label={selected.count} /></Stack>
      <Typography variant="body2" color="text.secondary">{selected.explanation}</Typography>
    </Paper>}
    {hasCode && sources.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
      Dashed arrows show suggested connections between sources in this snapshot. Motion illustrates data flow, not live traffic. Live connections and cloud hosting have not been verified.
    </Typography>}
  </Box>;
}

import React, { useId } from 'react';
import { Box, Paper, Typography, useTheme } from '@mui/material';

export function systemSources(data = {}) {
  const sources = [];
  if (data.database) sources.push({ id: 'database', name: data.database.dialect === 'mysql' ? 'MySQL database' : 'PostgreSQL database', detail: 'Stores structured information', action: 'Reads and saves data' });
  if (data.mongo_database) sources.push({ id: 'mongo', name: 'MongoDB database', detail: 'Stores flexible documents', action: 'Reads and saves documents' });
  if (data.object_storage) {
    const provider = data.object_storage.provider;
    const name = { 'aws-s3': 'AWS S3 storage', 'azure-blob': 'Azure Blob storage', 's3-compatible': 'S3-compatible storage' }[provider] || 'Cloud file storage';
    sources.push({ id: 'storage', name, detail: 'Stores files, images, and uploads', action: 'Uploads and retrieves files' });
  }
  return sources;
}

export default function SystemArchitecture({ data = {}, compact = false }) {
  const theme = useTheme();
  const marker = useId().replace(/:/g, '');
  const sources = systemSources(data);
  const hasCode = Boolean(data.codebase);
  const height = Math.max(220, sources.length * 130 + 40);
  const center = height / 2;
  const color = theme.palette.primary.main;
  const text = theme.palette.text.primary;
  const muted = theme.palette.text.secondary;
  const card = (x, y, name, detail) => <g transform={`translate(${x}, ${y})`}>
    <rect width="270" height="82" rx="14" fill={theme.palette.background.paper} stroke={theme.palette.divider} />
    <text x="18" y="32" fill={text} fontSize="17" fontWeight="600">{name}</text>
    <text x="18" y="57" fill={muted} fontSize="13">{detail}</text>
  </g>;
  return <Box>
    <Typography variant={compact ? 'subtitle2' : 'h6'} sx={{ mb: 1 }}>System Design Architecture Diagram</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      {hasCode ? 'The application runs your code and works with the data sources shown here.' : 'Data sources found in this snapshot. Add a codebase to show the application server.'}
    </Typography>
    <Paper variant="outlined" sx={{ p: 1.5, overflowX: 'auto' }}>
      <svg role="img" aria-label="System architecture showing the application and available databases and cloud storage" viewBox={`0 0 850 ${height}`} style={{ display: 'block', width: '100%', minWidth: 620, fontFamily: theme.typography.fontFamily }}>
        <title>System Design Architecture Diagram</title>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill={color} /></marker></defs>
        {hasCode && sources.map((source, index) => {
          const y = 40 + index * 130 + 41;
          return <g key={source.id}>
            <path d={`M300 ${center} C410 ${center}, 410 ${y}, 540 ${y}`} fill="none" stroke={color} strokeWidth="2" strokeDasharray="6 5" markerEnd={`url(#${marker})`} />
            <rect x="322" y={y - 28} width="206" height="24" rx="6" fill={theme.palette.background.paper} />
            <text x="425" y={y - 12} textAnchor="middle" fill={muted} fontSize="12">{source.action}</text>
          </g>;
        })}
        {hasCode && card(30, center - 41, 'Application server', 'Runs your project codebase')}
        {sources.map((source, index) => <React.Fragment key={source.id}>{card(hasCode ? 550 : 290, 40 + index * 130, source.name, source.detail)}</React.Fragment>)}
        {!sources.length && <text x={hasCode ? 550 : 80} y={center} fill={muted} fontSize="14">No data sources in this snapshot</text>}
      </svg>
    </Paper>
    {hasCode && sources.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
      Dashed arrows show suggested connections between sources in this snapshot. Live connections and cloud hosting have not been verified.
    </Typography>}
  </Box>;
}

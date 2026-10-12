import React, { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.2;

const GRAPH_COLUMN_ORDER = ["route", "table", "collection", "bucket"];
const NODE_WIDTH = 190;
const NODE_HEIGHT = 28;
const ROW_GAP = 8;
const COLUMN_GAP = 130;
const PADDING = 24;
const HEADER_HEIGHT = 30;

function truncateLabel(name, max = 25) {
  if (!name) return "";
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export default function ArchitectureDiagram({ graph }) {
  const theme = useTheme();
  const [hoveredId, setHoveredId] = useState(null);
  const [filter, setFilter] = useState("");
  const [zoom, setZoom] = useState(1);

  const layout = useMemo(() => {
    const byType = {};
    for (const n of graph.nodes) (byType[n.type] ||= []).push(n);
    const presentColumns = GRAPH_COLUMN_ORDER.filter((t) => byType[t]?.length);
    const extraTypes = Object.keys(byType).filter((t) => !GRAPH_COLUMN_ORDER.includes(t));
    const columns = [...presentColumns, ...extraTypes];

    const positions = {};
    columns.forEach((type, colIdx) => {
      const nodes = [...(byType[type] || [])].sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach((n, rowIdx) => {
        positions[n.id] = {
          node: n,
          x: PADDING + colIdx * (NODE_WIDTH + COLUMN_GAP),
          y: PADDING + HEADER_HEIGHT + rowIdx * (NODE_HEIGHT + ROW_GAP),
          col: colIdx,
        };
      });
    });

    const maxRows = Math.max(1, ...columns.map((t) => byType[t]?.length || 0));
    const width = PADDING * 2 + columns.length * NODE_WIDTH + Math.max(0, columns.length - 1) * COLUMN_GAP;
    const height = PADDING * 2 + HEADER_HEIGHT + maxRows * (NODE_HEIGHT + ROW_GAP);

    const edges = (graph.edges || [])
      .map((e, i) => {
        const from = positions[e.from];
        const to = positions[e.to];
        if (!from || !to) return null;
        let d;
        if (from.col === to.col) {
          const sx = from.x + NODE_WIDTH, sy = from.y + NODE_HEIGHT / 2;
          const tx = to.x + NODE_WIDTH, ty = to.y + NODE_HEIGHT / 2;
          const bulge = 42 + Math.min(60, Math.abs(sy - ty) * 0.08);
          d = `M ${sx} ${sy} C ${sx + bulge} ${sy}, ${tx + bulge} ${ty}, ${tx} ${ty}`;
        } else {
          const x1 = from.x + NODE_WIDTH, y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x, y2 = to.y + NODE_HEIGHT / 2;
          const midX = (x1 + x2) / 2;
          d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        }
        return { id: `e${i}`, d, from: e.from, to: e.to, kind: e.kind };
      })
      .filter(Boolean);

    return { positions, columns, width, height, edges };
  }, [graph]);

  const filterLower = filter.trim().toLowerCase();
  const matchesFilter = (node) => !filterLower || (node?.name || "").toLowerCase().includes(filterLower);

  const nodeDimmed = (id) => {
    if (hoveredId) {
      if (id === hoveredId) return false;
      return !layout.edges.some((e) => (e.from === hoveredId && e.to === id) || (e.to === hoveredId && e.from === id));
    }
    if (filterLower) return !matchesFilter(layout.positions[id]?.node);
    return false;
  };
  const edgeDimmed = (e) => {
    if (hoveredId) return e.from !== hoveredId && e.to !== hoveredId;
    if (filterLower) return !matchesFilter(layout.positions[e.from]?.node) && !matchesFilter(layout.positions[e.to]?.node);
    return false;
  };

  const edgeColor = theme.palette.primary.main;
  const nodeFill = theme.palette.mode === "dark" ? theme.palette.grey[800] : theme.palette.grey[50];
  const nodeBorder = theme.palette.divider;
  const textColor = theme.palette.text.primary;
  const faintColor = theme.palette.text.secondary;

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
        <TextField
          size="small" placeholder="Filter by name…" value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ maxWidth: 280 }}
        />
        <Stack direction="row" spacing={0.5} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 0.25 }}>
          <Tooltip title="Zoom out">
            <span><IconButton size="small" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(1)))} disabled={zoom <= ZOOM_MIN}><ZoomOutIcon fontSize="small" /></IconButton></span>
          </Tooltip>
          <Tooltip title="Reset zoom">
            <IconButton size="small" onClick={() => setZoom(1)}><RestartAltIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title="Zoom in">
            <span><IconButton size="small" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(1)))} disabled={zoom >= ZOOM_MAX}><ZoomInIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        </Stack>
        <Typography variant="caption" sx={{ fontFamily: (t) => t.tokens.fontMono }}>{Math.round(zoom * 100)}%</Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, overflow: "auto", maxHeight: 640 }}>
        <Box sx={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <svg width={layout.width} height={layout.height} style={{ display: "block", transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            {layout.columns.map((type, i) => (
              <text key={type} x={PADDING + i * (NODE_WIDTH + COLUMN_GAP)} y={PADDING + 14} fontSize="11" fontWeight="600" fill={faintColor} style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {type}s
              </text>
            ))}
            {layout.edges.map((e) => (
              <path
                key={e.id} d={e.d} fill="none"
                stroke={edgeDimmed(e) ? nodeBorder : edgeColor}
                strokeWidth={edgeDimmed(e) ? 1 : 1.4}
                strokeDasharray={e.kind === "references" ? "4 3" : e.kind === "uploads_to" ? "1 3" : undefined}
                opacity={edgeDimmed(e) ? 0.35 : 0.7}
              />
            ))}
            {Object.values(layout.positions).map(({ node, x, y }) => (
              <g
                key={node.id} transform={`translate(${x}, ${y})`}
                onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId(null)}
                style={{ cursor: "pointer", opacity: nodeDimmed(node.id) ? 0.3 : 1 }}
              >
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={6} fill={nodeFill} stroke={hoveredId === node.id ? edgeColor : nodeBorder} strokeWidth={hoveredId === node.id ? 1.5 : 1} />
                <text x={10} y={NODE_HEIGHT / 2 + 4} fontSize="11.5" fill={textColor} fontFamily={theme.tokens.fontMono}>{truncateLabel(node.name)}</text>
                <title>{node.name}</title>
              </g>
            ))}
          </svg>
        </Box>
      </Paper>

      <Stack direction="row" spacing={3} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap rowGap={0.5}>
        <Typography variant="caption">Hover a node to highlight its connections</Typography>
        {[
          { label: "Foreign key", dash: undefined },
          { label: "Inferred reference", dash: "4 3" },
          { label: "Uploads to", dash: "1 3" },
        ].map((l) => (
          <Stack key={l.label} direction="row" spacing={0.75} alignItems="center">
            <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke={faintColor} strokeWidth="1.4" strokeDasharray={l.dash} /></svg>
            <Typography variant="caption">{l.label}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

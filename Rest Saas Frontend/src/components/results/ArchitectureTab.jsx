import React, { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Stack from "@mui/material/Stack";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import CloudQueueOutlinedIcon from "@mui/icons-material/CloudQueueOutlined";
import AltRouteOutlinedIcon from "@mui/icons-material/AltRouteOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import ArchitectureDiagram from "./ArchitectureDiagram";
import EntityRow from "./EntityRow";
const NODE_ICON = {
  table: DnsOutlinedIcon,
  collection: StorageOutlinedIcon,
  bucket: CloudQueueOutlinedIcon,
  route: AltRouteOutlinedIcon,
};
const EDGE_LABEL = {
  fk: "foreign key →",
  references: "references →",
  uploads_to: "uploads to →",
};
export default function ArchitectureTab({ graph }) {
  const [view, setView] = useState("diagram");
  const nodesById = useMemo(
    () => Object.fromEntries(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );
  const edgesByFrom = useMemo(() => {
    const map = {};
    for (const e of graph.edges) (map[e.from] ||= []).push(e);
    return map;
  }, [graph.edges]);
  const groups = useMemo(() => {
    const byType = {};
    for (const n of graph.nodes) (byType[n.type] ||= []).push(n);
    return byType;
  }, [graph.nodes]);
  return (
    <Box>
      <Stack
        direction="row"
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          mb: 2.5,
        }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            maxWidth: 520,
          }}
        >
          {graph.nodes.length} nodes, {graph.edges.length} edges — tables,
          collections, storage buckets, and detected routes merged into one
          graph instead of four separate trees.
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(e, v) => v && setView(v)}
        >
          <ToggleButton value="diagram">Diagram</ToggleButton>
          <ToggleButton value="list">List</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {view === "diagram" && <ArchitectureDiagram graph={graph} />}

      {view === "list" &&
        Object.entries(groups).map(([type, nodes]) => (
          <Box
            key={type}
            sx={{
              mb: 3,
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                mb: 1.25,
                textTransform: "capitalize",
              }}
            >
              {type}s{" "}
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{
                  fontFamily: (t) => t.tokens.fontMono,
                }}
              >
                ({nodes.length})
              </Typography>
            </Typography>
            {nodes.map((n) => {
              const NodeIcon = NODE_ICON[n.type] || CategoryOutlinedIcon;
              const outgoing = edgesByFrom[n.id] || [];
              return (
                <EntityRow
                  key={n.id}
                  name={
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: "center",
                      }}
                    >
                      <NodeIcon fontSize="small" />
                      <span>{n.name}</span>
                    </Stack>
                  }
                  meta={
                    outgoing.length > 0 ? (
                      <span>
                        {outgoing.length} edge{outgoing.length === 1 ? "" : "s"}
                      </span>
                    ) : null
                  }
                >
                  {Object.keys(n.meta || {}).length > 0 && (
                    <Box
                      component="dl"
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "160px 1fr",
                        rowGap: 0.5,
                        m: 0,
                        mb: outgoing.length ? 1.5 : 0,
                      }}
                    >
                      {Object.entries(n.meta).map(([k, v]) => (
                        <React.Fragment key={k}>
                          <Typography
                            component="dt"
                            variant="body2"
                            color="text.secondary"
                          >
                            {k}
                          </Typography>
                          <Typography
                            component="dd"
                            variant="body2"
                            sx={{
                              m: 0,
                            }}
                          >
                            {Array.isArray(v)
                              ? v.join(", ") || "—"
                              : String(v ?? "—")}
                          </Typography>
                        </React.Fragment>
                      ))}
                    </Box>
                  )}
                  {outgoing.map((e, i) => (
                    <Box
                      key={i}
                      sx={{
                        fontFamily: (t) => t.tokens.fontMono,
                        fontSize: 12.5,
                        py: 0.5,
                        color: "text.secondary",
                      }}
                    >
                      <Box
                        component="span"
                        sx={{
                          color: "text.primary",
                          fontWeight: 500,
                        }}
                      >
                        {EDGE_LABEL[e.kind] || e.kind}
                      </Box>{" "}
                      {nodesById[e.to]?.name || e.to}
                    </Box>
                  ))}
                </EntityRow>
              );
            })}
          </Box>
        ))}
    </Box>
  );
}

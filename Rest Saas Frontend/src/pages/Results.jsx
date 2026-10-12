import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Skeleton from "@mui/material/Skeleton";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import CloudQueueOutlinedIcon from "@mui/icons-material/CloudQueueOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";

import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/format";
import FreshnessCheck from "../components/results/FreshnessCheck";
import { OverviewTab, PostgresTab, MongoTab, StorageTab } from "../components/results/Tabs";
import CodebaseTab from "../components/results/CodebaseTab";
import ArchitectureTab from "../components/results/ArchitectureTab";
import ChangesTab, { countDiffItems } from "../components/results/ChangesTab";
import JsonViewer from "../components/results/JsonTree";

export default function Results() {
  const { contextId } = useParams();
  const { request } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [diffData, setDiffData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setDiffData(null);
    setTab("overview");
    request(`/api/ingestion/${contextId}/`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    request(`/api/ingestion/${contextId}/diff/`)
      .then((res) => { if (!cancelled) setDiffData(res); })
      .catch(() => { /* non-critical — the Changes tab just won't offer itself */ });
    return () => { cancelled = true; };
  }, [request, contextId]);

  if (error) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/dashboard")} sx={{ mb: 2 }}>Saved contexts</Button>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/dashboard")} sx={{ mb: 2 }}>Saved contexts</Button>
        <Skeleton variant="text" width={300} height={44} sx={{ mb: 1 }} />
        <Skeleton variant="rounded" height={220} />
      </Box>
    );
  }

  const meta = data._meta || {};
  const rawChars = JSON.stringify(data).length;
  const distilledChars = JSON.stringify(data.claude_context || {}).length;
  const rawTokensApprox = Math.round(rawChars / 4);
  const distilledTokensApprox = Math.round(distilledChars / 4);
  const reductionPct = rawChars > 0 ? Math.round((1 - distilledChars / rawChars) * 100) : 0;
  const database = data.database;
  const mongo = data.mongo_database;
  const storage = data.object_storage;
  const codebase = data.codebase;
  const graph = data.architecture_graph;

  const tabs = [
    { id: "overview", label: "Overview" },
    database && { id: "postgres", label: "PostgreSQL", n: database.tables?.length },
    mongo && { id: "mongo", label: "MongoDB", n: mongo.collections?.length },
    storage && { id: "storage", label: "Storage", n: (storage.buckets || storage.containers || []).length },
    codebase && { id: "codebase", label: "Codebase" },
    graph && { id: "architecture", label: "Architecture", n: graph.nodes?.length },
    diffData?.has_previous && { id: "changes", label: "Changes", n: countDiffItems(diffData.diff) },
    { id: "raw", label: "Raw JSON" },
  ].filter(Boolean);

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/dashboard")} sx={{ mb: 1, ml: -1 }}>Saved contexts</Button>

      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "flex-start" }} spacing={2} sx={{ mb: 4 }}>
        <Box>
          <Typography variant="overline">Ingestion context</Typography>
          <Typography variant="h4" sx={{ mt: 0.25, mb: 0.5 }}>{meta.project?.project_name || "Untitled project"}</Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Generated {formatDate(meta.generated_at)} · {meta.ingestion_duration_ms ? `${(meta.ingestion_duration_ms / 1000).toFixed(1)}s` : "—"}
          </Typography>
          <FreshnessCheck contextId={contextId} />
        </Box>
        <Stack alignItems={{ xs: "flex-start", md: "flex-end" }} spacing={1}>
          <Button variant="contained" startIcon={<AutoAwesomeIcon fontSize="small" />} onClick={() => navigate(`/contexts/${contextId}/claude-context`)}>
            View claude_context
          </Button>
          {data.claude_context && (
            <Chip
              size="small" variant="outlined"
              label={`~${rawTokensApprox.toLocaleString()} → ~${distilledTokensApprox.toLocaleString()} tokens (${reductionPct}% smaller)`}
              sx={{ fontFamily: (t) => t.tokens.fontMono, fontWeight: 400 }}
            />
          )}
        </Stack>
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 1.5, mb: 4 }}>
        {[
          database && { label: "Tables", value: database.tables?.length ?? 0, icon: DnsOutlinedIcon },
          mongo && { label: "Collections", value: mongo.collections?.length ?? 0, icon: StorageOutlinedIcon },
          storage && { label: "Buckets", value: (storage.buckets || storage.containers || []).length, icon: CloudQueueOutlinedIcon },
          codebase && { label: "Files indexed", value: codebase.file_tree?.total_files ?? 0, icon: InsertDriveFileOutlinedIcon },
        ].filter(Boolean).map((s) => (
          <Card variant="outlined" key={s.label}>
            <CardContent sx={{ display: "flex", alignItems: "center", gap: 1.5, py: "14px !important" }}>
              <s.icon fontSize="small" sx={{ color: "text.secondary" }} />
              <Box>
                <Typography variant="h6" sx={{ lineHeight: 1.1, fontFamily: (t) => t.tokens.fontMono, fontSize: "1.125rem" }}>{s.value.toLocaleString()}</Typography>
                <Typography variant="caption">{s.label}</Typography>
              </Box>
            </CardContent>
          </Card>
        ))}
      </Box>

      {meta.errors && (
        <Box sx={{ mb: 2 }}>
          {Object.entries(meta.errors).map(([k, v]) => <Alert key={k} severity="error" sx={{ mb: 1 }}>{k}: {String(v)}</Alert>)}
        </Box>
      )}

      <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.n !== undefined ? `${t.label} (${t.n})` : t.label} />
        ))}
      </Tabs>

      {tab === "overview" && <OverviewTab meta={meta} database={database} mongo={mongo} storage={storage} codebase={codebase} summary={data.plain_english_summary} />}
      {tab === "postgres" && database && <PostgresTab database={database} />}
      {tab === "mongo" && mongo && <MongoTab mongo={mongo} />}
      {tab === "storage" && storage && <StorageTab storage={storage} />}
      {tab === "codebase" && codebase && <CodebaseTab codebase={codebase} />}
      {tab === "architecture" && graph && <ArchitectureTab graph={graph} />}
      {tab === "changes" && diffData?.has_previous && <ChangesTab diffData={diffData} />}
      {tab === "raw" && <JsonViewer data={data} filename={`context-${contextId}.json`} />}
    </Box>
  );
}

import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Stack from "@mui/material/Stack";

import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import CloudQueueOutlinedIcon from "@mui/icons-material/CloudQueueOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";

import { GitHubIcon } from "../BrandIcons";
import { formatBytes } from "../../lib/format";
import EntityRow from "./EntityRow";

// ─── Overview ───────────────────────────────────────────────────────────────

export function OverviewTab({ meta, database, mongo, storage, codebase, summary }) {
  const cards = [
    database && { label: "PostgreSQL", value: `${database.tables?.length ?? 0} tables`, sub: database.metadata?.database_name, icon: DnsOutlinedIcon },
    mongo && {
      label: "MongoDB",
      value: `${mongo.collections?.length ?? 0} collections`,
      sub: mongo.scan_mode === "all_databases" ? `${mongo.metadata?.scanned_databases?.length ?? "?"} databases` : mongo.metadata?.database_name,
      icon: StorageOutlinedIcon,
    },
    storage && { label: "Object storage", value: `${(storage.buckets || storage.containers || []).length} bucket(s)`, sub: storage.provider, icon: CloudQueueOutlinedIcon },
    codebase && { label: "Repository", value: codebase.repository?.full_name || "—", sub: codebase.stack?.languages?.join(", "), icon: GitHubIcon },
  ].filter(Boolean);

  return (
    <Box>
      {summary && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ display: "flex", gap: 1.5 }}>
            <AutoAwesomeOutlinedIcon sx={{ mt: 0.25, color: "text.secondary" }} fontSize="small" />
            <Box>
              <Typography variant="overline">What this is</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.6, color: "text.primary" }}>{summary}</Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 1.5, mb: 4 }}>
        {cards.map((c) => (
          <Card variant="outlined" key={c.label}>
            <CardContent sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
              <Box sx={{ width: 34, height: 34, borderRadius: 1.5, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <c.icon fontSize="small" sx={{ color: "text.secondary" }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption">{c.label}</Typography>
                <Typography fontWeight={600}>{c.value}</Typography>
                {c.sub && <Typography variant="caption" sx={{ fontFamily: (t) => t.tokens.fontMono }} noWrap component="div">{c.sub}</Typography>}
              </Box>
            </CardContent>
          </Card>
        ))}
      </Box>

      {codebase?.stack && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 1.25 }}>Detected stack</Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 4 }}>
            {[...(codebase.stack.frameworks || []), ...(codebase.stack.orms || []), ...(codebase.stack.languages || [])].map((s) => (
              <Chip key={s} label={s} size="small" variant="outlined" />
            ))}
          </Stack>
        </>
      )}

      {database?.relationship_graph?.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 1.25 }}>Relationships (Postgres)</Typography>
          <Table size="small" sx={{ mb: 4 }}>
            <TableHead><TableRow><TableCell>From</TableCell><TableCell>Column</TableCell><TableCell>References</TableCell></TableRow></TableHead>
            <TableBody>
              {database.relationship_graph.slice(0, 12).map((r, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono }}>{r.from}</TableCell>
                  <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono }}>{r.from_column}</TableCell>
                  <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono }}>{r.to}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <Typography variant="subtitle2" sx={{ mb: 1.25 }}>Run metadata</Typography>
      <Card variant="outlined">
        <CardContent component="dl" sx={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 1, m: 0 }}>
          <Typography component="dt" variant="body2" color="text.secondary">Schema version</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, fontFamily: (t) => t.tokens.fontMono }}>{meta.schema_version || "—"}</Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Duration</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, fontFamily: (t) => t.tokens.fontMono }}>{meta.ingestion_duration_ms ? `${meta.ingestion_duration_ms} ms` : "—"}</Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Sources ingested</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{Object.entries(meta.sources || {}).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}</Typography>
        </CardContent>
      </Card>
    </Box>
  );
}

// ─── PostgreSQL ─────────────────────────────────────────────────────────────

export function PostgresTab({ database }) {
  return (
    <Box>
      {(database.tables || []).map((t) => (
        <EntityRow
          key={`${t.schema}.${t.name}`}
          name={`${t.schema}.${t.name}`}
          meta={<>
            <span>{t.columns?.length ?? 0} cols</span>
            <span>{t.foreign_keys?.length ?? 0} fks</span>
            <span>{t.estimated_rows ?? "?"} rows</span>
          </>}
        >
          <Table size="small">
            <TableHead><TableRow><TableCell>Column</TableCell><TableCell>Type</TableCell><TableCell>Null</TableCell><TableCell>Default</TableCell></TableRow></TableHead>
            <TableBody>
              {(t.columns || []).map((c) => (
                <TableRow key={c.name}>
                  <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5 }}>
                    {c.name}
                    {t.primary_keys?.includes(c.name) && <Chip label="PK" size="small" variant="outlined" sx={{ ml: 1, height: 18, fontSize: 10 }} />}
                    {c.is_storage_reference && <Chip label="storage ref" size="small" color="info" variant="outlined" sx={{ ml: 1, height: 18, fontSize: 10 }} />}
                  </TableCell>
                  <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono }}>{c.type}</TableCell>
                  <TableCell>{c.nullable ? "yes" : "no"}</TableCell>
                  <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono }}>{c.default || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </EntityRow>
      ))}
    </Box>
  );
}

// ─── MongoDB ────────────────────────────────────────────────────────────────

function MongoCollectionRow({ c }) {
  return (
    <EntityRow
      name={c.name}
      meta={<>
        <span>{Object.keys(c.schema_shape || {}).length} fields</span>
        <span>{c.indexes?.length ?? 0} indexes</span>
        <span>~{c.estimated_documents ?? "?"} docs</span>
      </>}
    >
      <Table size="small">
        <TableHead><TableRow><TableCell>Field</TableCell><TableCell>Shape</TableCell></TableRow></TableHead>
        <TableBody>
          {Object.entries(c.schema_shape || {}).map(([k, v]) => (
            <TableRow key={k}>
              <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5 }}>{k}</TableCell>
              <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono }}>{typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </EntityRow>
  );
}

export function MongoTab({ mongo }) {
  const collections = mongo.collections || [];
  const databases = Array.from(new Set(collections.map((c) => c.database).filter(Boolean)));

  if (databases.length < 2) {
    return <Box>{collections.map((c) => <MongoCollectionRow key={c.database ? `${c.database}.${c.name}` : c.name} c={c} />)}</Box>;
  }

  return (
    <Box>
      {databases.map((dbName) => (
        <Box key={dbName} sx={{ mb: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
            <StorageOutlinedIcon fontSize="small" />
            <Typography variant="subtitle2">{dbName}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: (t) => t.tokens.fontMono }}>({collections.filter((c) => c.database === dbName).length})</Typography>
          </Stack>
          {collections.filter((c) => c.database === dbName).map((c) => <MongoCollectionRow key={`${dbName}.${c.name}`} c={c} />)}
        </Box>
      ))}
    </Box>
  );
}

// ─── Object storage ─────────────────────────────────────────────────────────

export function StorageTab({ storage }) {
  const buckets = storage.containers || storage.buckets || [];
  return (
    <Box>
      {buckets.map((b) => (
        <EntityRow
          key={b.name}
          name={b.name}
          meta={<>
            <span>{b.file_count_sampled ?? b.objects_sample?.length ?? 0} sampled</span>
            <span>{formatBytes(b.approx_total_size_bytes)}</span>
          </>}
        >
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1.5 }}>
            {Object.entries(b.content_types || b.summary?.by_type || {}).map(([type, n]) => (
              <Chip key={type} size="small" variant="outlined" label={`${type}: ${n}`} />
            ))}
          </Stack>
          {b.folders?.length > 0 && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>Folders</Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1.5 }}>
                {b.folders.map((f) => <Chip key={f} size="small" variant="outlined" label={f} />)}
              </Stack>
            </>
          )}
          {(b.example_keys || []).length > 0 && (
            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5, fontFamily: (t) => t.tokens.fontMono, fontSize: 12, whiteSpace: "pre-wrap" }}>
              {(b.example_keys || []).join("\n")}
            </Box>
          )}
        </EntityRow>
      ))}
    </Box>
  );
}

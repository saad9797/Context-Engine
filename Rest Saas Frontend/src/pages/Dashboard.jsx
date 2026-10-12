import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";

import AddIcon from "@mui/icons-material/Add";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import CloudQueueOutlinedIcon from "@mui/icons-material/CloudQueueOutlined";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";

import { useAuth } from "../context/AuthContext";
import { GitHubIcon } from "../components/BrandIcons";
import { formatDate } from "../lib/format";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import SearchField from "../components/SearchField";

const SOURCE_CHIPS = [
  { key: "database", label: "Postgres", icon: DnsOutlinedIcon },
  { key: "mongo_database", label: "Mongo", icon: StorageOutlinedIcon },
  { key: "object_storage", label: "Storage", icon: CloudQueueOutlinedIcon },
  { key: "codebase", label: "GitHub", icon: GitHubIcon },
];

export default function Dashboard() {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    request("/api/ingestion/")
      .then((res) => { if (!cancelled) setItems(res); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [request]);

  const filtered = useMemo(() => {
    if (!items) return null;
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((c) => (c.project_name || "").toLowerCase().includes(q) || (c.summary?.repository || "").toLowerCase().includes(q));
  }, [items, query]);

  return (
    <Box>
      <PageHeader
        title="Dashboard"
        description="Everything you've ingested — each entry keeps its full raw snapshot and its distilled claude_context."
        action={
          <Button variant="contained" startIcon={<AddIcon fontSize="small" />} onClick={() => navigate("/ingest/new")}>
            New ingestion
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {items === null && !error && (
        <Stack spacing={1.5}>
          {[1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={84} />)}
        </Stack>
      )}

      {items && items.length === 0 && (
        <EmptyState
          icon={ScienceOutlinedIcon}
          title="Nothing ingested yet"
          description="Point Contexa at a database, storage bucket, or GitHub repo to generate your first distilled context."
          action={<Button variant="contained" startIcon={<AddIcon fontSize="small" />} onClick={() => navigate("/ingest/new")}>New ingestion</Button>}
        />
      )}

      {items && items.length > 0 && (
        <>
          <SearchField value={query} onChange={setQuery} placeholder="Search projects…" sx={{ mb: 2.5 }} />
          <Stack spacing={1.25}>
            {(filtered || []).map((c) => (
              <Card variant="outlined" key={c.id}>
                <CardActionArea onClick={() => navigate(`/contexts/${c.id}`)}>
                  <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                    <Box sx={{ flex: 1, minWidth: 200 }}>
                      <Typography variant="body1" fontWeight={600}>{c.project_name || "Untitled project"}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: (t) => t.tokens.fontMono }}>
                        {formatDate(c.created_at)}{c.summary?.repository ? ` · ${c.summary.repository}` : ""}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75}>
                      {SOURCE_CHIPS.filter(({ key }) => c.sources?.[key]).map(({ key, label, icon: Icon }) => (
                        <Chip key={key} size="small" icon={<Icon fontSize="small" />} label={label} variant="outlined" />
                      ))}
                    </Stack>
                    <Stack direction="row" spacing={2.5} sx={{ minWidth: 160, justifyContent: "flex-end" }}>
                      {c.summary?.postgres_tables != null && (
                        <Box sx={{ textAlign: "right" }}>
                          <Typography variant="body2" fontWeight={600} sx={{ fontFamily: (t) => t.tokens.fontMono }}>{c.summary.postgres_tables}</Typography>
                          <Typography variant="caption">tables</Typography>
                        </Box>
                      )}
                      {c.summary?.mongo_collections != null && (
                        <Box sx={{ textAlign: "right" }}>
                          <Typography variant="body2" fontWeight={600} sx={{ fontFamily: (t) => t.tokens.fontMono }}>{c.summary.mongo_collections}</Typography>
                          <Typography variant="caption">collections</Typography>
                        </Box>
                      )}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}

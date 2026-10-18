import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Button,
  Alert,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Chip,
  Skeleton,
} from "@mui/material";
import Add from "@mui/icons-material/Add";
import ArrowForward from "@mui/icons-material/ArrowForward";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import DataObject from "@mui/icons-material/DataObject";
import Code from "@mui/icons-material/Code";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/format";
import PageHeader from "../components/PageHeader";
import SearchField from "../components/SearchField";
const sources = [
  ["database", "PostgreSQL"],
  ["mongo_database", "MongoDB"],
  ["object_storage", "Storage"],
  ["codebase", "GitHub"],
];
export default function Dashboard() {
  const { request, user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    request("/api/ingestion/")
      .then((res) => {
        if (!cancelled) setItems(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [request, reload]);
  const filtered = useMemo(
    () =>
      (items || []).filter((c) =>
        `${c.project_name || ""} ${c.summary?.repository || ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [items, query],
  );
  const projectCount = new Set(
    (items || []).map((c) => c.project_name || c.summary?.repository || c.id),
  ).size;
  const sourceCount = new Set(
    (items || []).flatMap((c) =>
      sources.filter(([key]) => c.sources?.[key]).map(([key]) => key),
    ),
  ).size;
  return (
    <Box>
      <PageHeader
        title="Your project library"
        description="The big picture, saved. Pick a snapshot to explore your stack or prepare your next AI prompt."
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => navigate("/ingest/new")}
          >
            Build a snapshot
          </Button>
        }
      />
      <div className="workspace-greeting">
        <div>
          <div className="eyebrow">YOUR NEXT SESSION STARTS HERE</div>
          <h2>
            {items?.length
              ? `Welcome back${user?.username ? `, ${user.username}` : ""}. Keep the context close.`
              : "A clearer project. A better starting point."}
          </h2>
          <p>
            {items?.length
              ? "Explore a saved snapshot, see how your architecture connects, or copy focused context into the AI tool you already use."
              : "Connect a repository or database and turn the scattered pieces of your project into one useful overview."}
          </p>
        </div>
        <div className="greeting-art">
          <Code />
          <span />
          <AccountTreeOutlined />
          <span />
          <DataObject />
        </div>
      </div>
      {error && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setReload((n) => n + 1)}
            >
              Try again
            </Button>
          }
          sx={{
            mb: 3,
          }}
        >
          {error}
        </Alert>
      )}
      {items === null && !error && (
        <Stack spacing={2} aria-label="Loading project snapshots">
          {[1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              variant="rounded"
              sx={{
                height: 90,
              }}
            />
          ))}
        </Stack>
      )}
      {items && (
        <>
          <div className="workspace-stats">
            <div className="workspace-stat">
              <span>Projects</span>
              <strong>{projectCount}</strong>
              <small>Across your saved snapshots</small>
            </div>
            <div className="workspace-stat">
              <span>Saved snapshots</span>
              <strong>{items.length}</strong>
              <small>Ready to explore and reuse</small>
            </div>
            <div className="workspace-stat">
              <span>Source types represented</span>
              <strong>
                {sourceCount}
                <Typography
                  component="span"
                  sx={{
                    fontSize: 12,
                    ml: 1,
                    color: "text.secondary",
                  }}
                >
                  of 4
                </Typography>
              </strong>
              <small>Code, databases, and storage</small>
            </div>
          </div>
          {items.length === 0 ? (
            <Box>
              <Typography variant="h6">Make yourself at home.</Typography>
              <Typography
                variant="body2"
                sx={{
                  mt: 0.5,
                }}
              >
                Your first snapshot is a few steps away.
              </Typography>
              <div className="onboarding-grid">
                {[
                  [
                    "01",
                    "Connect your stack",
                    "Start with a GitHub repository or database. Your credentials are encrypted.",
                    "/connections",
                    "Connect a source",
                  ],
                  [
                    "02",
                    "Build your first snapshot",
                    "Choose your sources and let Contexa assemble the project overview.",
                    "/ingest/new",
                    "Build a snapshot",
                  ],
                  [
                    "03",
                    "Explore the possibilities",
                    "See an interactive example before connecting your own project.",
                    "/#product",
                    "Explore the example",
                  ],
                ].map(([n, t, d, url, label]) => (
                  <article className="onboarding-step" key={n}>
                    <span>{n}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                    {url.startsWith("/#") ? (
                      <a href={url}>
                        {label}
                        <ArrowForward />
                      </a>
                    ) : (
                      <Link to={url}>
                        {label}
                        <ArrowForward />
                      </Link>
                    )}
                  </article>
                ))}
              </div>
            </Box>
          ) : (
            <>
              <Stack
                direction={{
                  xs: "column",
                  sm: "row",
                }}
                spacing={2}
                sx={{
                  justifyContent: "space-between",
                  alignItems: {
                    sm: "center",
                  },
                  mb: 2.5,
                }}
              >
                <Typography variant="h6">
                  Saved snapshots{" "}
                  <Typography
                    component="span"
                    sx={{
                      ml: 1,
                      color: "text.secondary",
                      fontSize: 13,
                    }}
                  >
                    {items.length}
                  </Typography>
                </Typography>
                <SearchField
                  value={query}
                  onChange={setQuery}
                  placeholder="Find a project…"
                  sx={{
                    width: {
                      xs: "100%",
                      sm: 260,
                    },
                  }}
                />
              </Stack>
              <Stack spacing={1.5}>
                {filtered.map((c) => (
                  <Card key={c.id}>
                    <CardActionArea
                      onClick={() => navigate(`/contexts/${c.id}`)}
                    >
                      <CardContent
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                          flexWrap: "wrap",
                          p: 2.5,
                          "&:last-child": {
                            pb: 2.5,
                          },
                        }}
                      >
                        <Box
                          sx={{
                            width: 42,
                            height: 42,
                            display: "grid",
                            placeItems: "center",
                            borderRadius: 2,
                            bgcolor: "action.selected",
                            color: "primary.main",
                          }}
                        >
                          <AccountTreeOutlined
                            sx={{
                              fontSize: 20,
                            }}
                          />
                        </Box>
                        <Box
                          sx={{
                            flex: 1,
                            minWidth: 150,
                          }}
                        >
                          <Typography
                            sx={{
                              fontWeight: 600,
                              fontSize: 14,
                              mb: 0.5,
                            }}
                          >
                            {c.project_name || "Untitled project"}
                          </Typography>
                          <Typography variant="caption">
                            {c.summary?.repository
                              ? `${c.summary.repository} · `
                              : ""}
                            {formatDate(c.created_at)}
                          </Typography>
                        </Box>
                        <Stack
                          direction="row"
                          sx={{
                            gap: 0.75,
                            flexWrap: "wrap",
                          }}
                        >
                          {sources
                            .filter(([key]) => c.sources?.[key])
                            .map(([key, label]) => (
                              <Chip
                                key={key}
                                size="small"
                                label={label}
                                variant="outlined"
                              />
                            ))}
                        </Stack>
                        {c.summary?.postgres_tables != null && (
                          <Typography
                            variant="caption"
                            sx={{
                              minWidth: 65,
                              textAlign: "right",
                            }}
                          >
                            {c.summary.postgres_tables} tables
                          </Typography>
                        )}
                        <ArrowForward
                          sx={{
                            fontSize: 17,
                            color: "text.secondary",
                            ml: 1,
                          }}
                        />
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
              </Stack>
              {filtered.length === 0 && (
                <Box
                  sx={{
                    py: 7,
                    textAlign: "center",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 3,
                  }}
                >
                  <Typography variant="subtitle1">
                    No matching projects
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 1,
                    }}
                  >
                    Try a different name or clear your search.
                  </Typography>
                  <Button
                    onClick={() => setQuery("")}
                    sx={{
                      mt: 2,
                    }}
                  >
                    Clear search
                  </Button>
                </Box>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}

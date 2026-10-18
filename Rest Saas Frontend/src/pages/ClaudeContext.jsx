import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import CheckIcon from "@mui/icons-material/Check";
import { useAuth } from "../context/AuthContext";
import { approxTokens, copyToClipboard } from "../lib/format";
import JsonViewer from "../components/results/JsonTree";
import { useToast } from "../components/ToastProvider";
import PageHeader from "../components/PageHeader";
const BUDGET_OPTIONS = [
  {
    value: "",
    label: "No limit",
  },
  {
    value: "8000",
    label: "8,000 tokens",
  },
  {
    value: "4000",
    label: "4,000 tokens",
  },
  {
    value: "2000",
    label: "2,000 tokens",
  },
];
export default function ClaudeContext() {
  const { contextId } = useParams();
  const { request } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [appliedTask, setAppliedTask] = useState("");
  const [budget, setBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    (task, maxTokens) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (task) params.set("task", task);
      if (maxTokens) params.set("max_tokens", maxTokens);
      const qs = params.toString();
      request(
        `/api/ingestion/${contextId}/claude-context/${qs ? `?${qs}` : ""}`,
      )
        .then((res) => setData(res))
        .catch((e) => setError(e))
        .finally(() => setLoading(false));
    },
    [request, contextId],
  );
  useEffect(() => {
    setData(null);
    setTaskInput("");
    setAppliedTask("");
    setBudget("");
    load("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId]);
  const applyTask = () => {
    const trimmed = taskInput.trim();
    setAppliedTask(trimmed);
    load(trimmed, budget);
  };
  const clearTask = () => {
    setTaskInput("");
    setAppliedTask("");
    load("", budget);
  };
  const changeBudget = (_e, value) => {
    if (value === null) return;
    setBudget(value);
    load(appliedTask, value);
  };
  const copyPrompt = async () => {
    const prompt = `Here is my project's schema and codebase context, distilled for code generation:\n\n${JSON.stringify(data, null, 2)}\n\nTask: ${appliedTask || "Help me with my next task using the architecture and conventions in this context. Ask what I want to build before proposing changes."}`;
    const ok = await copyToClipboard(prompt);
    setPromptCopied(ok);
    if (!ok)
      showToast(
        "Could not copy. Select the context from the preview and copy it manually.",
        "error",
      );
    setTimeout(() => setPromptCopied(false), 1600);
  };
  const copyJson = async () => {
    const ok = await copyToClipboard(JSON.stringify(data, null, 2));
    setJsonCopied(ok);
    if (!ok)
      showToast(
        "Could not copy. Select the context from the preview and copy it manually.",
        "error",
      );
    setTimeout(() => setJsonCopied(false), 1600);
  };
  const info = data?._scoping;
  const currentTokens = data ? approxTokens(data) : null;
  return (
    <Box>
      <Button
        startIcon={<ArrowBackIcon fontSize="small" />}
        onClick={() => navigate(`/contexts/${contextId}`)}
        sx={{
          mb: 1,
          ml: -1,
        }}
      >
        Back to project
      </Button>
      <PageHeader
        title="Context for your next prompt"
        description="Choose a task and a token budget. Copy focused project context into Claude, Codex, or the AI tool you already use."
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: "300px 1fr",
          },
          gap: 3,
          alignItems: "flex-start",
        }}
      >
        {/* Controls */}
        <Card
          variant="outlined"
          sx={{
            position: {
              md: "sticky",
            },
            top: {
              md: 24,
            },
          }}
        >
          <CardContent>
            <Typography
              variant="subtitle2"
              sx={{
                mb: 1,
              }}
            >
              Task
            </Typography>
            <TextField
              label="What are you working on?"
              fullWidth
              multiline
              minRows={2}
              placeholder='What are you building? e.g. "add an endpoint for applicant job applications"'
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              sx={{
                mb: 1,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                display: "block",
                mb: 1.5,
              }}
            >
              Trims the context down to what's relevant — leave blank for
              everything.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                fullWidth
                startIcon={
                  loading ? (
                    <CircularProgress size={13} color="inherit" />
                  ) : (
                    <AutoAwesomeIcon fontSize="small" />
                  )
                }
                onClick={applyTask}
                disabled={loading || !taskInput.trim()}
              >
                Scope to task
              </Button>
              {appliedTask && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={clearTask}
                  disabled={loading}
                  aria-label="Clear task scope"
                >
                  <CloseIcon fontSize="small" />
                </Button>
              )}
            </Stack>

            <Divider
              sx={{
                my: 2.5,
              }}
            />

            <Typography
              variant="subtitle2"
              sx={{
                mb: 1,
              }}
            >
              Token budget
            </Typography>
            <ToggleButtonGroup
              orientation="vertical"
              size="small"
              exclusive
              value={budget}
              onChange={changeBudget}
              disabled={loading}
              fullWidth
            >
              {BUDGET_OPTIONS.map((o) => (
                <ToggleButton
                  key={o.value}
                  value={o.value}
                  sx={{
                    justifyContent: "flex-start",
                    px: 1.5,
                    fontFamily: (t) => t.tokens.fontMono,
                    fontWeight: 400,
                  }}
                >
                  {o.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Divider
              sx={{
                my: 2.5,
              }}
            />

            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
              }}
            >
              <Typography variant="body2">Current size</Typography>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: (t) => t.tokens.fontMono,
                  fontWeight: 500,
                }}
              >
                {currentTokens !== null
                  ? `~${currentTokens.toLocaleString()} tokens`
                  : "—"}
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        {/* Preview */}
        <Box
          sx={{
            minWidth: 0,
          }}
        >
          {info && info.matched === true && (
            <Alert
              severity="info"
              sx={{
                mb: 2,
              }}
            >
              Scoped to "{info.task}": ~
              {info.approx_tokens_full?.toLocaleString()} → ~
              {info.approx_tokens_scoped?.toLocaleString()} tokens (
              {info.reduction_pct}% smaller). Keyword/heuristic matching, not
              semantic search.
            </Alert>
          )}
          {info && info.matched === false && (
            <Alert
              severity="warning"
              sx={{
                mb: 2,
              }}
            >
              Nothing matched "{info.task}" closely enough, so the full context
              is shown instead of an empty or misleading scope.
            </Alert>
          )}
          {info && info.budget_applied && (
            <Alert
              severity="warning"
              sx={{
                mb: 2,
              }}
            >
              Trimmed to fit a {Number(info.max_tokens).toLocaleString()}-token
              budget: ~{info.approx_tokens_before_budget?.toLocaleString()} → ~
              {info.approx_tokens_after_budget?.toLocaleString()} tokens.
            </Alert>
          )}
          {error && (
            <Alert
              severity="error"
              sx={{
                mb: 2,
              }}
            >
              {error.message}
              {error.status === 404 && (
                <Box
                  sx={{
                    mt: 0.75,
                  }}
                >
                  This context may have been saved before claude_context existed
                  — re-run the ingestion to regenerate it.
                </Box>
              )}
            </Alert>
          )}

          {!data && !error && (
            <Stack spacing={1.5}>
              <Skeleton
                variant="rounded"
                sx={{
                  height: 44,
                }}
              />
              <Skeleton
                variant="rounded"
                sx={{
                  height: 400,
                }}
              />
            </Stack>
          )}

          {data && (
            <>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  justifyContent: "flex-end",
                  mb: 1.5,
                }}
              >
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={
                    jsonCopied ? (
                      <CheckIcon fontSize="small" />
                    ) : (
                      <ContentCopyOutlinedIcon fontSize="small" />
                    )
                  }
                  onClick={copyJson}
                  disabled={loading}
                >
                  {jsonCopied ? "Copied" : "Copy JSON"}
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={
                    promptCopied ? (
                      <CheckIcon fontSize="small" />
                    ) : (
                      <ContentCopyOutlinedIcon fontSize="small" />
                    )
                  }
                  onClick={copyPrompt}
                  disabled={loading}
                >
                  {promptCopied ? "Prompt copied" : "Copy ready-to-use prompt"}
                </Button>
              </Stack>
              <JsonViewer
                data={data}
                filename={`project-context-${contextId}.json`}
                hideCopy
              />
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

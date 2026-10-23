import "./ingestion-progress.css";
import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Dialog,
  Tooltip,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import DnsOutlined from "@mui/icons-material/DnsOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import CloudQueueOutlined from "@mui/icons-material/CloudQueueOutlined";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import AutoAwesomeOutlined from "@mui/icons-material/AutoAwesomeOutlined";
import LayersOutlined from "@mui/icons-material/LayersOutlined";
import Check from "@mui/icons-material/Check";
import ArrowForward from "@mui/icons-material/ArrowForward";
import ArrowBack from "@mui/icons-material/ArrowBack";
import OpenInFull from "@mui/icons-material/OpenInFull";
import CloseFullscreen from "@mui/icons-material/CloseFullscreen";
import ExpandMore from "@mui/icons-material/ExpandMore";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import ScheduleOutlined from "@mui/icons-material/ScheduleOutlined";
import { useAuth } from "../context/AuthContext";
import { GitHubIcon } from "../components/BrandIcons";

const SOURCES = [
  {
    stage: "postgres",
    key: "database",
    name: "SQL database",
    label: "Read database schema",
    detail: "Tables, columns & relationships",
    icon: DnsOutlined,
    headline: "Finding the structure in your data.",
    description:
      "Inspecting tables, columns, keys, and relationships in your SQL database without reading application records.",
  },
  {
    stage: "mongo",
    key: "mongo_database",
    name: "MongoDB",
    label: "Read MongoDB collections",
    detail: "Collections, shapes & indexes",
    icon: StorageOutlined,
    headline: "Making sense of your collections.",
    description:
      "Inspecting document shapes and indexes to understand how your data is organized.",
  },
  {
    stage: "storage",
    key: "object_storage",
    name: "Object storage",
    label: "Inspect object storage",
    detail: "Buckets, folders & file types",
    icon: CloudQueueOutlined,
    headline: "Bringing your storage into view.",
    description:
      "Inspecting buckets and folder conventions to place your files in the bigger picture.",
  },
  {
    stage: "github",
    key: "codebase",
    name: "GitHub",
    label: "Index your repository",
    detail: "Code, routes & conventions",
    icon: GitHubIcon,
    headline: "Getting to know your codebase.",
    description:
      "Reading your repository's structure, routes, and conventions for a more useful project overview.",
  },
];
const ASSEMBLE = {
  stage: "assembling",
  label: "Map architecture & prepare context",
  headline: "The bigger picture is coming together.",
  description:
    "Connecting the inspected sources and distilling your project's structure into focused AI context.",
  icon: AccountTreeOutlined,
};
const SAVE = {
  stage: "saving",
  label: "Save your project snapshot",
  headline: "Putting the finishing touches on it.",
  description:
    "Saving the assembled snapshot so you can explore it and reuse its context in your next AI session.",
  icon: AutoAwesomeOutlined,
};
const COLLECT = {
  stage: "collecting",
  name: "Project sources",
  label: "Inspect your project sources",
  detail: "Your connected stack",
  headline: "Getting to know your project.",
  description:
    "Inspecting your connected sources. Each update comes directly from your running build.",
  icon: LayersOutlined,
};

function formatElapsed(start, end) {
  const seconds = Math.max(0, Math.floor((end - Date.parse(start)) / 1000));
  if (!Number.isFinite(seconds)) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function BuildVisualization({
  sources,
  phase,
  phaseIndex,
  phases,
  state,
  projectName,
}) {
  const isReady = state === "ready";
  const mapped = isReady || phase.stage === "saving";
  const CoreIcon = isReady
    ? Check
    : state === "failed"
      ? ErrorOutline
      : phase.icon;
  const rows = sources.length ? sources : [COLLECT];
  return (
    <div
      className={`build-visualization build-visualization-${state}`}
      aria-hidden="true"
    >
      <div className="build-grid-pattern" />
      <div className="build-column-label build-source-label">YOUR SOURCES</div>
      <div className="build-column-label build-engine-label">
        MAKING THE CONNECTIONS
      </div>
      <div className="build-column-label build-output-label">
        ONE CLEAR PICTURE
      </div>
      <svg
        className="build-wires"
        viewBox="0 0 800 390"
        preserveAspectRatio="none"
      >
        {rows.map((source, i) => {
          const y = 195 + (i - (rows.length - 1) / 2) * 76;
          const index = phases.findIndex((p) => p.stage === source.stage);
          const processed = isReady || (index >= 0 && phaseIndex > index);
          const active =
            state === "running" &&
            (phase.stage === source.stage || phase.stage === "collecting");
          return (
            <g key={source.stage}>
              <path
                className={`build-wire ${processed ? "processed" : ""}`}
                d={`M 197 ${y} C 280 ${y}, 265 195, 365 195`}
              />
              {active && (
                <path
                  className="build-wire-flow"
                  d={`M 197 ${y} C 280 ${y}, 265 195, 365 195`}
                />
              )}
            </g>
          );
        })}
        <path
          className={`build-wire ${mapped ? "processed" : ""}`}
          d="M 430 195 C 500 195, 480 195, 573 195"
        />
        {state === "running" &&
          ["assembling", "saving"].includes(phase.stage) && (
            <path
              className="build-wire-flow"
              d="M 430 195 C 500 195, 480 195, 573 195"
            />
          )}
      </svg>
      <div className="build-source-stack">
        {rows.map((source) => {
          const index = phases.findIndex((p) => p.stage === source.stage);
          const processed = isReady || (index >= 0 && phaseIndex > index);
          const active =
            state === "running" &&
            (phase.stage === source.stage || phase.stage === "collecting");
          const Icon = source.icon;
          return (
            <div
              key={source.stage}
              className={`build-source-node${active ? " is-active" : ""}${processed ? " is-processed" : ""}`}
            >
              <div className="build-source-icon">
                <Icon />
              </div>
              <div>
                <strong>{source.name}</strong>
                <span>
                  {processed
                    ? "Processed"
                    : active
                      ? "Inspecting…"
                      : state === "queued"
                        ? "Waiting"
                        : "Queued"}
                </span>
              </div>
              {processed ? (
                <Check className="build-node-check" />
              ) : (
                <i className="build-node-light" />
              )}
            </div>
          );
        })}
      </div>
      <div className={`build-core${state === "running" ? " is-working" : ""}`}>
        <div className="build-core-orbit" />
        <div className="build-core-ring" />
        <div className="build-core-face" key={phase.stage + state}>
          <CoreIcon />
        </div>
        <span>
          {isReady
            ? "Connected."
            : state === "failed"
              ? "Paused"
              : state === "queued"
                ? "On standby"
                : "contexa"}
        </span>
      </div>
      <div
        className={`build-output${mapped ? " is-mapped" : ""}${isReady ? " is-ready" : ""}`}
      >
        <div className="build-output-top">
          <span className="build-document-icon">
            <AccountTreeOutlined />
          </span>
          <span>
            {isReady ? (
              <Check />
            ) : (
              <span className="build-output-dots">•••</span>
            )}
          </span>
        </div>
        <strong>{projectName || "Your project"}</strong>
        <span className="build-output-subtitle">Project snapshot</span>
        <div className="build-output-rule" />
        {[
          [AccountTreeOutlined, "Architecture"],
          [StorageOutlined, "Data & relationships"],
          [AutoAwesomeOutlined, "AI context"],
        ].map(([Icon, label], i) => (
          <div
            className={`build-output-row${mapped ? " is-revealed" : ""}`}
            key={label}
            style={{ "--reveal-delay": `${i * 110}ms` }}
          >
            <Icon />
            <span>{label}</span>
            {mapped ? <Check /> : <i />}
          </div>
        ))}
        <div className="build-output-footer">
          {isReady
            ? "Ready to explore"
            : mapped
              ? "Saving your snapshot"
              : "Taking shape as you build"}
        </div>
      </div>
      <div className="build-canvas-caption">
        {isReady
          ? "Your sources, brought together in one place."
          : state === "queued"
            ? "Your build will begin when a worker is available."
            : state === "failed"
              ? "Your build stopped. Review the details below."
              : state === "reconnecting"
                ? "Showing the last update. Reconnecting to your build…"
                : "A live view of your build. Source details appear in the finished snapshot."}
      </div>
    </div>
  );
}

export default function IngestionProgress() {
  const { jobId } = useParams();
  const { request } = useAuth();
  const navigate = useNavigate();
  const { state: routeState } = useLocation();
  const theme = useTheme();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [job, setJob] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [log, setLog] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const expandButton = useRef(null);
  const observedJob = useRef(null);
  const lastReportedStage = useRef(null);
  const wasExpanded = useRef(false);

  // A stage marker is emitted AFTER each source inspection, not before it.
  // Move to the next selected source; do not simulate progress between updates.
  const sources = useMemo(
    () =>
      routeState?.sourcesEnabled
        ? SOURCES.filter((s) => routeState.sourcesEnabled[s.key])
        : [],
    [routeState?.sourcesEnabled],
  );
  const phases = useMemo(
    () => [
      {
        stage: "starting",
        label: "Connect to your sources",
        icon: LayersOutlined,
      },
      ...(sources.length ? sources : [COLLECT]),
      ASSEMBLE,
      SAVE,
    ],
    [sources],
  );
  const ready = job?.status === "succeeded";
  const failed = job?.status === "failed";
  const queued = job?.status === "pending";
  let phaseIndex = 0;
  if (ready) phaseIndex = phases.length;
  else if (job?.stage === "finalizing") phaseIndex = phases.length - 1;
  else if (job?.stage && job.stage !== "starting") {
    const reported = phases.findIndex((p) => p.stage === (job.stage === "mysql" ? "postgres" : job.stage));
    phaseIndex = reported >= 0 ? Math.min(reported + 1, phases.length - 1) : 1;
  } else if (job?.status === "running") phaseIndex = 1;
  const phase = phases[Math.min(phaseIndex, phases.length - 1)];
  const state = ready
    ? "ready"
    : failed
      ? "failed"
      : connectionError
        ? "reconnecting"
        : queued
          ? "queued"
          : job
            ? "running"
            : "loading";
  const percent = ready
    ? 100
    : Math.max(0, Math.min(100, Number(job?.progress_pct) || 0));
  const projectName = routeState?.projectName;
  const elapsed = job?.started_at
    ? formatElapsed(
        job.started_at,
        job.finished_at ? Date.parse(job.finished_at) : now,
      )
    : null;
  const openSnapshot = () => {
    if (job?.result)
      startTransition(() =>
        navigate(`/contexts/${job.result}${routeState?.carryTask ? '/claude-context' : ''}`, {
          replace: true,
          state: { fromBuild: true, ...(routeState?.carryTask ? { carryTask: routeState.carryTask } : {}) },
        }),
      );
  };

  useEffect(() => {
    void import("./Results").catch(() => {});
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer;
    let failures = 0;
    if (observedJob.current !== jobId) {
      observedJob.current = jobId;
      lastReportedStage.current = null;
      setJob(null);
      setLog([]);
      setConnectionError(null);
      setLeaving(false);
    }
    async function poll() {
      try {
        const next = await request(`/api/ingestion/jobs/${jobId}/`);
        if (stopped) return;
        failures = 0;
        setConnectionError(null);
        setJob(next);
        if (next.stage && next.stage !== lastReportedStage.current) {
          lastReportedStage.current = next.stage;
          const source = SOURCES.find((s) => s.stage === next.stage);
          const label =
            next.status === "succeeded"
              ? "Snapshot saved"
              : source
                ? `${source.name} inspection finished`
                : next.stage === "finalizing"
                  ? "Project assembled; saving snapshot"
                  : "Build started";
          setLog((entries) => [
            ...entries,
            { label, pct: next.progress_pct, ts: Date.now() },
          ]);
        }
        if (["succeeded", "failed"].includes(next.status)) return;
        timer = setTimeout(poll, 2000);
      } catch (error) {
        if (stopped) return;
        setConnectionError(error.message);
        failures += 1;
        timer = setTimeout(poll, Math.min(10000, 2000 * failures));
      }
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, request, retry]);

  useEffect(() => {
    if (!job?.started_at || ready || failed) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job?.started_at, ready, failed]);

  useEffect(() => {
    if (!ready || !job?.result) return;
    const fade = setTimeout(() => setLeaving(true), reducedMotion ? 400 : 1500);
    const route = setTimeout(
      () =>
        startTransition(() =>
          navigate(`/contexts/${job.result}${routeState?.carryTask ? '/claude-context' : ''}`, {
            replace: true,
            state: { fromBuild: true, ...(routeState?.carryTask ? { carryTask: routeState.carryTask } : {}) },
          }),
        ),
      reducedMotion ? 500 : 1850,
    );
    return () => {
      clearTimeout(fade);
      clearTimeout(route);
    };
  }, [ready, job?.result, navigate, reducedMotion, routeState?.carryTask]);

  useEffect(() => {
    if (!expanded && wasExpanded.current) expandButton.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);

  const title = ready
    ? "Your project, in perspective."
    : failed
      ? "Your build needs attention."
      : connectionError
        ? "Reconnecting to your build."
        : queued
          ? "Your snapshot is in line."
          : !job
            ? "Finding your build."
            : phase.headline || "Connecting the pieces.";
  const description = ready
    ? "Your snapshot is ready. Opening your project overview…"
    : failed
      ? "The build stopped before a snapshot could be saved. Your connected sources have not been changed."
      : connectionError
        ? "Your build can continue in the background. We’ll restore live updates as soon as the connection returns."
        : queued
          ? "Waiting for an available worker. This view will update automatically when your build starts."
          : !job
            ? "Checking the latest status of your project snapshot."
            : phase.description ||
              "Opening your connected sources to understand how your project fits together.";
  const content = (
    <Box
      className={`build-experience${expanded ? " is-expanded" : ""}${leaving ? " is-leaving" : ""}`}
      style={{
        "--build-surface": theme.palette.background.paper,
        "--build-bg": theme.palette.background.default,
        "--build-border": theme.palette.divider,
        "--build-text": theme.palette.text.primary,
        "--build-muted": theme.palette.text.secondary,
        "--build-accent": theme.palette.primary.main,
        "--build-tint": theme.palette.action.selected,
        "--build-success": theme.palette.success.main,
      }}
    >
      <div className="build-page-top">
        <div>
          <span className="eyebrow">PROJECT SNAPSHOT</span>
          <h1 id="build-project-title">
            {projectName || "Bringing your project together"}
          </h1>
        </div>
        <Tooltip
          title={expanded ? "Exit focus view (Esc)" : "Expand to focus view"}
        >
          <Button
            ref={expandButton}
            variant="outlined"
            size="small"
            startIcon={expanded ? <CloseFullscreen /> : <OpenInFull />}
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Exit focus view" : "Expand to focus view"}
          >
            {expanded ? "Exit focus view" : "Focus view"}
          </Button>
        </Tooltip>
      </div>
      <section
        className={`build-stage build-stage-${state}`}
        aria-labelledby="build-stage-title"
      >
        <div className="build-narrative">
          <div className={`build-live-label build-live-label-${state}`}>
            {ready ? (
              <Check />
            ) : failed ? (
              <ErrorOutline />
            ) : queued ? (
              <ScheduleOutlined />
            ) : (
              <span className="build-live-dot" />
            )}
            {ready
              ? "SNAPSHOT READY"
              : failed
                ? "BUILD STOPPED"
                : connectionError
                  ? "RESTORING LIVE UPDATES"
                  : queued
                    ? "QUEUED"
                    : !job
                      ? "CHECKING STATUS"
                      : "LIVE BUILD"}
          </div>
          <div
            key={state + phase.stage}
            className="build-stage-copy"
            aria-live="polite"
            aria-atomic="true"
          >
            <h2 id="build-stage-title">{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        <div className="build-workspace">
          <BuildVisualization
            sources={sources}
            phase={phase}
            phaseIndex={phaseIndex}
            phases={phases}
            state={state}
            projectName={projectName}
          />
          <aside className="build-checklist">
            <div className="build-checklist-heading">
              <span>BUILD PROGRESS</span>
              <strong>
                {ready
                  ? "All pieces in place"
                  : `${Math.min(phaseIndex, phases.length)} of ${phases.length} stages processed`}
              </strong>
            </div>
            <ol>
              {phases.map((p, i) => {
                const done = ready || i < phaseIndex;
                const active = !ready && !queued && !!job && i === phaseIndex;
                const status = done
                  ? "done"
                  : active
                    ? failed
                      ? "error"
                      : "active"
                    : "pending";
                return (
                  <li
                    className={`build-step is-${status}`}
                    key={p.stage}
                    aria-current={active ? "step" : undefined}
                  >
                    <span className="build-step-marker">
                      {done ? (
                        <Check />
                      ) : active && failed ? (
                        <ErrorOutline />
                      ) : (
                        <span>{String(i + 1).padStart(2, "0")}</span>
                      )}
                    </span>
                    <div>
                      <strong>{p.label}</strong>
                      <span>
                        {done
                          ? "Processed"
                          : active
                            ? failed
                              ? "Stopped here"
                              : connectionError
                                ? "Last reported stage"
                                : "In progress"
                            : "Up next"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
        <div className="build-progress-footer">
          <div className="build-progress-summary">
            <span>
              {ready
                ? "Snapshot saved"
                : failed
                  ? "Build stopped"
                  : connectionError
                    ? "Last reported progress"
                    : queued
                      ? "Waiting for a worker"
                      : "Building your snapshot"}
              {elapsed && <small> · {elapsed} elapsed</small>}
            </span>
            <strong>
              {percent}
              <span>%</span>
            </strong>
          </div>
          <div
            className="build-progress-track"
            role="progressbar"
            aria-label="Snapshot build progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div style={{ width: `${percent}%` }} />
          </div>
          <div className="build-progress-helper">
            <span>
              {ready
                ? "Opening your overview"
                : "Progress updates as each stage finishes."}
            </span>
            <span>
              {ready
                ? "Ready for your next AI session"
                : "You can leave this page. The build keeps running."}
            </span>
          </div>
        </div>
      </section>
      {failed && (
        <Alert
          severity="error"
          sx={{ mt: 2.5 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => navigate("/ingest/new")}
            >
              Review setup
            </Button>
          }
        >
          {job.error ||
            "The snapshot could not be completed. Review your sources and try a new build."}
        </Alert>
      )}
      {connectionError && (
        <Alert
          severity="warning"
          sx={{ mt: 2.5 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setRetry((n) => n + 1)}
            >
              Reconnect now
            </Button>
          }
        >
          Live updates were interrupted. Retrying automatically.{" "}
          {connectionError}
        </Alert>
      )}
      <div className="build-bottom-bar">
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate("/dashboard")}
        >
          Back to project library
        </Button>
        {ready && job.result ? (
          <Button
            variant="contained"
            endIcon={<ArrowForward />}
            onClick={openSnapshot}
          >
            Open project now
          </Button>
        ) : (
          <span>Your connected sources stay unchanged.</span>
        )}
      </div>
      <details
        className="build-activity"
        open={logOpen}
        onToggle={(event) => setLogOpen(event.currentTarget.open)}
      >
        <summary>
          <span>
            Activity details{" "}
            <small>
              {log.length
                ? `${log.length} ${log.length === 1 ? "update" : "updates"}`
                : "Waiting for the first update"}
            </small>
          </span>
          <ExpandMore />
        </summary>
        <div className="build-activity-entries">
          {log.length ? (
            log.map((entry, i) => (
              <div key={`${entry.ts}-${i}`}>
                <time>
                  {new Date(entry.ts).toLocaleTimeString(undefined, {
                    hour12: false,
                  })}
                </time>
                <span>{entry.label}</span>
                <strong>{entry.pct ?? 0}%</strong>
              </div>
            ))
          ) : (
            <p>
              No stage updates yet. This log will fill as your build progresses.
            </p>
          )}
        </div>
      </details>
    </Box>
  );
  return expanded ? (
    <Dialog
      fullScreen
      open
      onClose={() => setExpanded(false)}
      aria-labelledby="build-project-title"
      slotProps={{ paper: { sx: { bgcolor: "background.default" } } }}
    >
      {content}
    </Dialog>
  ) : (
    content
  );
}

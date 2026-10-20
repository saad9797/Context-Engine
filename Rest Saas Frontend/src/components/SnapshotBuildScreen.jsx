import React, { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import AutoAwesomeOutlined from "@mui/icons-material/AutoAwesomeOutlined";

// Activity previews, not telemetry: inline HTTP requests do not stream stages.
export default function SnapshotBuildScreen({ open, projectName, database = false, mongo = false, storage = false, repository = false, rebuilding = false }) {
  const [step, setStep] = useState(0);
  const messages = [
    "Connecting to your selected sources",
    ...(database ? ["Reading database tables, relationships and enums"] : []),
    ...(mongo ? ["Inspecting MongoDB collections and document structure"] : []),
    ...(storage ? ["Inspecting storage metadata"] : []),
    ...(repository ? ["Reading repository source files and project conventions"] : []),
    ...(!database && !mongo && !storage && !repository ? ["Reading your connected project sources"] : []),
    "Mapping source relationships and preparing project context",
    "Waiting for your saved snapshot",
  ];
  useEffect(() => {
    setStep(0);
    if (!open) return undefined;
    const timer = setInterval(() => setStep(value => Math.min(value + 1, messages.length - 1)), 5500);
    return () => clearInterval(timer);
  }, [open, database, mongo, storage, repository]); // Labels are determined by these source flags.

  return <Dialog open={open} fullWidth maxWidth="sm" disableEscapeKeyDown aria-labelledby="snapshot-build-title"
    slotProps={{ paper: { sx: { borderRadius: 4, p: { xs: 3, sm: 5 }, textAlign: "center", overflow: "hidden" } } }}>
    <Box sx={{ display: "grid", placeItems: "center", width: 64, height: 64, borderRadius: "50%", bgcolor: "action.hover", color: "primary.main", mx: "auto", mb: 3 }}>
      <AutoAwesomeOutlined fontSize="large" />
    </Box>
    <Typography variant="overline" color="text.secondary">YOUR PROJECT, IN CONTEXT</Typography>
    <Typography id="snapshot-build-title" variant="h5" sx={{ mt: 1, mb: 1 }}>{rebuilding ? "Refreshing your snapshot" : "Building your snapshot"}</Typography>
    {projectName && <Typography color="text.secondary" sx={{ overflowWrap: "anywhere", mb: 2 }}>{projectName}</Typography>}
    <Box role="status" aria-live="polite" aria-atomic="true" sx={{ minHeight: 72, display: "grid", alignItems: "center", my: 2 }}>
      <Typography key={step} sx={{ animation: "snapshot-message-in .5s ease-out", "@keyframes snapshot-message-in": { from: { opacity: 0, transform: "translateY(6px)" }, to: { opacity: 1, transform: "translateY(0)" } }, "@media (prefers-reduced-motion: reduce)": { animation: "none" } }}>{messages[step]}</Typography>
    </Box>
    <LinearProgress aria-label="Snapshot request in progress" sx={{ height: 4, borderRadius: 2, mb: 3, "@media (prefers-reduced-motion: reduce)": { "& .MuiLinearProgress-bar": { animation: "none", transform: "none", width: "35%" } } }} />
    <Typography variant="body2" color="text.secondary">Keep this page open while we process your request.</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>Activity preview; actual stages may vary. The snapshot is ready only when the server confirms it.</Typography>
  </Dialog>;
}

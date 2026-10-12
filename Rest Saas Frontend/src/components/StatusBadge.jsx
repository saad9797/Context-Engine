import React from "react";
import Chip from "@mui/material/Chip";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import HourglassEmptyOutlinedIcon from "@mui/icons-material/HourglassEmptyOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";

// The app's actual status vocabulary — ingestion job status and freshness/
// drift, the only two real "status" concepts in this domain. One mapping
// so every place that shows a status (job polling, freshness checks,
// history) renders it identically.
const STATUS_MAP = {
  succeeded: { label: "Succeeded", color: "success", icon: CheckCircleOutlineIcon },
  fresh: { label: "Fresh", color: "success", icon: CheckCircleOutlineIcon },
  running: { label: "Running", color: "info", icon: HourglassEmptyOutlinedIcon },
  pending: { label: "Pending", color: "default", icon: HourglassEmptyOutlinedIcon },
  drifted: { label: "Drifted", color: "warning", icon: WarningAmberOutlinedIcon },
  failed: { label: "Failed", color: "error", icon: ErrorOutlineIcon },
  unknown: { label: "Unknown", color: "default", icon: HelpOutlineOutlinedIcon },
};

export default function StatusBadge({ status, label, size = "small" }) {
  const def = STATUS_MAP[status] || STATUS_MAP.unknown;
  const Icon = def.icon;
  return (
    <Chip
      size={size}
      variant="outlined"
      color={def.color === "default" ? undefined : def.color}
      icon={<Icon sx={{ fontSize: 14 }} />}
      label={label || def.label}
    />
  );
}

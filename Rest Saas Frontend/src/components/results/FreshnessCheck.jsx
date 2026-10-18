import React, { useState } from "react";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import GppGoodOutlinedIcon from "@mui/icons-material/GppGoodOutlined";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../StatusBadge";
export default function FreshnessCheck({ contextId }) {
  const { request } = useAuth();
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const check = () => {
    setState("loading");
    setError(null);
    request(`/api/ingestion/${contextId}/freshness/`)
      .then((res) => {
        setResult(res);
        setState("done");
      })
      .catch((e) => {
        setError(e);
        setState("error");
      });
  };
  if (state === "idle") {
    return (
      <Button
        size="small"
        variant="outlined"
        startIcon={<GppGoodOutlinedIcon fontSize="small" />}
        onClick={check}
      >
        Check freshness
      </Button>
    );
  }
  if (state === "loading") {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
        }}
      >
        <CircularProgress size={13} />
        <Typography variant="caption">Checking live sources…</Typography>
      </Stack>
    );
  }
  if (state === "error") {
    return (
      <Typography variant="caption">
        Couldn't check: {error.message}{" "}
        <Button size="small" onClick={check}>
          Retry
        </Button>
      </Typography>
    );
  }
  if (!result.checked_live) {
    return (
      <Typography variant="caption">
        {result.check_error
          ? `Live check failed: ${result.check_error}`
          : result.note}{" "}
        ({result.age_hours}h old)
      </Typography>
    );
  }
  if (result.source_errors) {
    return <Typography variant="caption">Partial freshness check: {Object.values(result.source_errors).join(" ")}{result.drifted ? " Other checked sources have changed; rebuild the snapshot." : " Rebuild to refresh unchecked sources."}</Typography>;
  }
  if (result.drifted) {
    const changed = Object.entries(result.details || {})
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
        }}
      >
        <StatusBadge status="drifted" />
        <Typography variant="caption">
          {changed.join(", ")} changed since generation — re-run ingestion to
          refresh.
        </Typography>
      </Stack>
    );
  }
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
      }}
    >
      <StatusBadge
        status="fresh"
        label={`No drift (${result.age_hours}h old)`}
      />
    </Stack>
  );
}

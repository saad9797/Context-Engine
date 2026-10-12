import React from "react";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import SearchIcon from "@mui/icons-material/Search";

// One search-input pattern, used everywhere a list/table is client-side
// filterable (Dashboard, Audit log). Deliberately plain — no debounce, no
// server round-trip — since every current use case filters an already-
// fetched, bounded list.
export default function SearchField({ value, onChange, placeholder = "Search…", sx }) {
  return (
    <TextField
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      size="small"
      sx={{ maxWidth: 320, ...sx }}
      InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
    />
  );
}

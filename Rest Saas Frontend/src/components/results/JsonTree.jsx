import React, { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import CheckIcon from "@mui/icons-material/Check";

import { copyToClipboard, downloadJSON } from "../../lib/format";

function ValueSpan({ value }) {
  if (value === null) return <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }}>null</Box>;
  if (typeof value === "string") return <Box component="span" sx={{ color: "warning.dark" }}>"{value}"</Box>;
  if (typeof value === "number") return <Box component="span" sx={{ color: "info.main" }}>{value}</Box>;
  if (typeof value === "boolean") return <Box component="span" sx={{ color: "secondary.main" }}>{String(value)}</Box>;
  return <Box component="span">{String(value)}</Box>;
}

function JsonNode({ label, value, depth, defaultOpen }) {
  const isObj = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const [open, setOpen] = useState(defaultOpen !== undefined ? defaultOpen : depth < 1);

  const rowSx = { display: "flex", alignItems: "flex-start", fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5, lineHeight: 1.7 };
  const toggleSx = { width: 16, flexShrink: 0, color: "text.secondary", cursor: "pointer", userSelect: "none" };

  if (!isObj) {
    return (
      <Box sx={rowSx}>
        <Box sx={toggleSx} />
        {label !== undefined && <Box component="span" sx={{ color: "secondary.main", mr: 0.5 }}>{label}:</Box>}
        <ValueSpan value={value} />
      </Box>
    );
  }

  const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
  const count = entries.length;
  const brackets = isArray ? ["[", "]"] : ["{", "}"];

  if (count === 0) {
    return (
      <Box sx={rowSx}>
        <Box sx={toggleSx} />
        {label !== undefined && <Box component="span" sx={{ color: "secondary.main", mr: 0.5 }}>{label}:</Box>}
        <Box component="span" sx={{ color: "text.secondary" }}>{brackets[0]}{brackets[1]}</Box>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={rowSx}>
        <Box sx={toggleSx} onClick={() => setOpen((o) => !o)}>
          <ChevronRightIcon sx={{ fontSize: 14, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s ease" }} />
        </Box>
        <Box onClick={() => setOpen((o) => !o)} sx={{ cursor: "pointer" }}>
          {label !== undefined && <Box component="span" sx={{ color: "secondary.main", mr: 0.5 }}>{label}:</Box>}
          <Box component="span" sx={{ color: "text.secondary" }}>{brackets[0]}</Box>
          {!open && <Box component="span" sx={{ color: "text.secondary" }}> {count} {isArray ? "items" : "keys"} {brackets[1]}</Box>}
        </Box>
      </Box>
      {open && (
        <Box sx={{ pl: 2, borderLeft: 1, borderColor: "divider", ml: 0.75 }}>
          {entries.map(([k, v]) => <JsonNode key={k} label={isArray ? undefined : k} value={v} depth={depth + 1} />)}
          <Box sx={rowSx}><Box sx={toggleSx} /><Box component="span" sx={{ color: "text.secondary" }}>{brackets[1]}</Box></Box>
        </Box>
      )}
    </Box>
  );
}

export default function JsonViewer({ data, filename = "context.json", hideCopy = false }) {
  const [copied, setCopied] = useState(false);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mb: 1.5 }}>
        {!hideCopy && (
          <Button
            size="small" variant="outlined"
            startIcon={copied ? <CheckIcon fontSize="small" /> : <ContentCopyOutlinedIcon fontSize="small" />}
            onClick={async () => {
              const ok = await copyToClipboard(JSON.stringify(data, null, 2));
              setCopied(ok);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        )}
        <Button size="small" variant="outlined" startIcon={<DownloadOutlinedIcon fontSize="small" />} onClick={() => downloadJSON(data, filename)}>
          Download
        </Button>
      </Stack>
      <Box sx={{ maxHeight: 560, overflowY: "auto" }}>
        <JsonNode value={data} depth={0} defaultOpen />
      </Box>
    </Paper>
  );
}

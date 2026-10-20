import React, { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import DownloadOutlined from "@mui/icons-material/DownloadOutlined";
import { copyToClipboard, downloadJSON } from "../../lib/format";

export default function SourceContextActions({ sourceKey, source, label, contextId }) {
  const [message, setMessage] = useState(null);
  const [copying, setCopying] = useState(false);
  // Keep the original source key so the JSON is self-describing, without
  // including global summaries, architecture graphs, or any other source.
  const payload = { [sourceKey]: source };
  return <Box sx={{ mb: 3 }}>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 1, alignItems: { sm: "center" } }}>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{label} context only</Typography>
      <Button variant="outlined" size="small" startIcon={<ContentCopyOutlined />} disabled={copying} onClick={async () => {
        setCopying(true); setMessage(null);
        try {
          const ok = await copyToClipboard(JSON.stringify(payload, null, 2));
          setMessage(ok ? { severity: "success", text: `${label} context JSON copied.` } : { severity: "warning", text: "Clipboard access is unavailable. Download the source JSON instead." });
        } catch {
          setMessage({ severity: "error", text: "Could not copy this source. Try downloading its JSON." });
        } finally { setCopying(false); }
      }}>{copying ? "Copying..." : "Copy context JSON"}</Button>
      <Button size="small" startIcon={<DownloadOutlined />} onClick={() => {
        try { downloadJSON(payload, `context-${contextId}-${sourceKey}.json`); }
        catch { setMessage({ severity: "error", text: "Could not download this source. Try copying its JSON." }); }
      }}>Download JSON</Button>
    </Stack>
    {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
  </Box>;
}

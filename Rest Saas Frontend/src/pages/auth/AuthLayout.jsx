import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

const FEATURES = [
  { icon: StorageOutlinedIcon, title: "Reads your real stack", body: "Postgres, MongoDB, object storage, and your GitHub repo — inspected directly, not guessed from a description." },
  { icon: ScienceOutlinedIcon, title: "Distilled for code generation", body: "Schema, relationships, and conventions only — scan stats and bulk sample data stripped out before it ever reaches a prompt." },
  { icon: AccountTreeOutlinedIcon, title: "One merged architecture graph", body: "Tables, collections, buckets, and routes as a single connected graph, not four JSON files to cross-reference by hand." },
  { icon: ShieldOutlinedIcon, title: "Encrypted before it leaves your browser", body: "Connection credentials are encrypted client-side before the request is sent, then again at rest — never echoed back after creation." },
];

export default function AuthLayout({ children }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isDark = theme.palette.mode === "dark";

  return (
    <Box sx={{ minHeight: "100vh", display: "flex" }}>
      {!isMobile && (
        <Box
          sx={{
            flex: "0 0 42%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            px: 7,
            py: 6,
            position: "relative",
            overflow: "hidden",
            bgcolor: isDark ? "grey.950" : "grey.900",
            color: "#fff",
            // The one place a gradient is allowed in the whole app — a
            // single, low-opacity tint from the accent color, not a
            // multi-color glow.
            backgroundImage: `radial-gradient(ellipse 800px 600px at 0% 0%, ${isDark ? "rgba(130,141,248,0.14)" : "rgba(91,99,240,0.16)"}, transparent 65%)`,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 7 }}>
            <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ScienceOutlinedIcon sx={{ fontSize: 18 }} />
            </Box>
            <Typography variant="h6">Contexa</Typography>
          </Box>

          <Typography variant="h3" sx={{ maxWidth: 400, mb: 2, fontSize: { md: 28, lg: 32 } }}>
            Give Claude the context it's missing.
          </Typography>
          <Typography sx={{ maxWidth: 400, mb: 5, opacity: 0.7, fontSize: 14, lineHeight: 1.7 }}>
            Contexa reads your existing infrastructure and distills it into one artifact
            sized for a coding model.
          </Typography>

          <Stack spacing={2.5}>
            {FEATURES.map((f) => (
              <Stack key={f.title} direction="row" spacing={1.75} alignItems="flex-start">
                <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: 0.25 }}>
                  <f.icon sx={{ fontSize: 15 }} />
                </Box>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "#fff" }}>{f.title}</Typography>
                  <Typography variant="body2" sx={{ opacity: 0.62, fontSize: 12.5, color: "#fff" }}>{f.body}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", px: 3, py: 6 }}>
        <Box sx={{ width: "100%", maxWidth: 380 }}>{children}</Box>
      </Box>
    </Box>
  );
}

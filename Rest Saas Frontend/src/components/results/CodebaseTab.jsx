import React, { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Paper from "@mui/material/Paper";

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";

import EntityRow from "./EntityRow";
import { formatBytes } from "../../lib/format";

function FileTreeNode({ node, depth }) {
  const isDir = node.type === "directory";
  const children = node.children || [];
  const [open, setOpen] = useState(depth < 1);

  const rowSx = { display: "flex", alignItems: "center", fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5, lineHeight: 1.9 };

  if (!isDir) {
    return (
      <Box sx={rowSx}>
        <Box sx={{ width: 16, flexShrink: 0 }} />
        <InsertDriveFileOutlinedIcon sx={{ fontSize: 14, mr: 0.75, flexShrink: 0, color: "text.secondary" }} />
        <Box component="span" sx={{ flex: 1 }}>{node.name}</Box>
        {node.role && <Box component="span" sx={{ fontSize: 10.5, color: "text.secondary", ml: 1 }}>{node.role}</Box>}
        <Box component="span" sx={{ fontSize: 11, color: "text.secondary", ml: 1 }}>{formatBytes(node.size_bytes)}</Box>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ ...rowSx, cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <Box sx={{ width: 16, flexShrink: 0, display: "flex", alignItems: "center" }}>
          <ChevronRightIcon sx={{ fontSize: 14, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s ease" }} />
        </Box>
        <FolderOutlinedIcon sx={{ fontSize: 14, mr: 0.75, flexShrink: 0, color: "text.secondary" }} />
        <Box component="span">{node.name}</Box>
        {!open && <Box component="span" sx={{ color: "text.secondary" }}>&nbsp;{children.length} item{children.length === 1 ? "" : "s"}</Box>}
      </Box>
      {open && (
        <Box sx={{ pl: 2, borderLeft: 1, borderColor: "divider", ml: 1 }}>
          {children.map((c, i) => <FileTreeNode key={`${c.name}-${i}`} node={c} depth={depth + 1} />)}
        </Box>
      )}
    </Box>
  );
}

export default function CodebaseTab({ codebase }) {
  const filesByRole = codebase.key_files_by_role || {};
  const fileTree = codebase.file_tree;

  return (
    <Box>
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent component="dl" sx={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 1, m: 0 }}>
          <Typography component="dt" variant="body2" color="text.secondary">Repository</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{codebase.repository?.full_name || "—"}</Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Default branch</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, fontFamily: (t) => t.tokens.fontMono }}>{codebase.repository?.default_branch || "—"}</Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Total files</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{fileTree?.total_files ?? "—"}</Typography>
        </CardContent>
      </Card>

      {fileTree?.tree?.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 1.25 }}>File tree</Typography>
          <Paper variant="outlined" sx={{ maxHeight: 420, overflowY: "auto", p: 1.5, mb: 3 }}>
            {fileTree.tree.map((n, i) => <FileTreeNode key={`${n.name}-${i}`} node={n} depth={0} />)}
          </Paper>
        </>
      )}

      <Typography variant="subtitle2" sx={{ mb: 1.25 }}>Key files by role</Typography>
      {Object.entries(filesByRole).map(([role, files]) => (
        <Box key={role} sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75, textTransform: "uppercase", letterSpacing: "0.04em" }}>{role}</Typography>
          {files.map((f) => (
            <EntityRow key={f.path} name={f.path} meta={<span>{formatBytes(f.size_bytes)}</span>}>
              <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5, fontFamily: (t) => t.tokens.fontMono, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 340, overflowY: "auto" }}>
                {f.content ? f.content.slice(0, 4000) : "(no content)"}
              </Box>
            </EntityRow>
          ))}
        </Box>
      ))}

      {codebase.env_vars && codebase.env_vars.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 0.5 }}>Environment variables ({codebase.env_vars.length})</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Key names and inferred purpose only, detected from a .env.example/.template file —
            values are never extracted or stored, even from the template itself.
          </Typography>
          <Table size="small">
            <TableHead><TableRow><TableCell>Key</TableCell><TableCell>Inferred purpose</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {codebase.env_vars.map((v) => (
                <TableRow key={v.name}>
                  <TableCell sx={{ fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5 }}>{v.name}</TableCell>
                  <TableCell>{v.inferred_purpose}</TableCell>
                  <TableCell>{v.likely_sensitive && <Chip size="small" color="error" variant="outlined" label="credential-shaped" />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </Box>
  );
}

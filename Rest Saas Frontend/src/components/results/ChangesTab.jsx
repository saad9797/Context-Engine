import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Alert from "@mui/material/Alert";

import { formatDate } from "../../lib/format";

function DiffList({ title, color, items }) {
  if (!items || items.length === 0) return null;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, color: `${color}.main`, display: "block", mb: 0.5 }}>
        {title} ({items.length})
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {items.map((item) => (
          <Box component="li" key={typeof item === "string" ? item : JSON.stringify(item)} sx={{ fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5, color: "text.secondary" }}>
            {typeof item === "string" ? item : `${item.column} — ${item.from} → ${item.to}`}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function ChangesTab({ diffData }) {
  const { diff, previous_generated_at } = diffData;
  const empty = Object.keys(diff || {}).length === 0;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Compared against the run generated {formatDate(previous_generated_at)} — structural
        changes only (schema shape, routes, key files), not every timestamp or sample-data difference.
      </Typography>

      {empty && <Alert severity="info">Nothing added, removed, or changed since the last run of this project.</Alert>}

      {diff.database && (
        <Card variant="outlined" sx={{ mb: 2.5 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>PostgreSQL</Typography>
            <DiffList title="Tables added" color="success" items={diff.database.tables_added} />
            <DiffList title="Tables removed" color="error" items={diff.database.tables_removed} />
            {(diff.database.tables_changed || []).map((t) => (
              <Box key={t.table} sx={{ mb: 1.5 }}>
                <Typography sx={{ fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5, fontWeight: 700, mb: 0.5 }}>{t.table}</Typography>
                <DiffList title="Columns added" color="success" items={t.columns_added} />
                <DiffList title="Columns removed" color="error" items={t.columns_removed} />
                <DiffList title="Type changed" color="warning" items={t.columns_type_changed} />
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {diff.mongo_database && (
        <Card variant="outlined" sx={{ mb: 2.5 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>MongoDB</Typography>
            <DiffList title="Collections added" color="success" items={diff.mongo_database.collections_added} />
            <DiffList title="Collections removed" color="error" items={diff.mongo_database.collections_removed} />
            {(diff.mongo_database.collections_changed || []).map((c) => (
              <Box key={c.collection} sx={{ mb: 1.5 }}>
                <Typography sx={{ fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5, fontWeight: 700, mb: 0.5 }}>{c.collection}</Typography>
                <DiffList title="Fields added" color="success" items={c.fields_added} />
                <DiffList title="Fields removed" color="error" items={c.fields_removed} />
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {diff.codebase && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Codebase</Typography>
            <DiffList title="Routes added" color="success" items={diff.codebase.routes_added} />
            <DiffList title="Routes removed" color="error" items={diff.codebase.routes_removed} />
            <DiffList title="Key files added" color="success" items={diff.codebase.key_files_added} />
            <DiffList title="Key files removed" color="error" items={diff.codebase.key_files_removed} />
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

export function countDiffItems(diff) {
  if (!diff) return 0;
  let n = 0;
  for (const section of Object.values(diff)) {
    for (const value of Object.values(section)) {
      if (Array.isArray(value)) n += value.length;
    }
  }
  return n;
}

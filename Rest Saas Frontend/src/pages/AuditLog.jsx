import React, { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableSortLabel from "@mui/material/TableSortLabel";
import Paper from "@mui/material/Paper";
import TableContainer from "@mui/material/TableContainer";
import TablePagination from "@mui/material/TablePagination";
import Chip from "@mui/material/Chip";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/format";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import SearchField from "../components/SearchField";
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];
const SORT_FIELDS = {
  action: (e) => e.action,
  when: (e) => e.created_at,
};
export default function AuditLog() {
  const { request } = useAuth();
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [sortBy, setSortBy] = useState("when");
  const [sortDir, setSortDir] = useState("desc");
  useEffect(() => {
    request("/api/audit-log/")
      .then((res) => setEntries(res))
      .catch((e) => setError(e.message));
  }, [request]);
  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    let rows = entries;
    if (q) {
      rows = rows.filter(
        (e) =>
          e.action.toLowerCase().includes(q) ||
          (e.target_type || "").toLowerCase().includes(q) ||
          (e.ip_address || "").toLowerCase().includes(q),
      );
    }
    const key = SORT_FIELDS[sortBy];
    const sorted = [...rows].sort((a, b) =>
      key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
    );
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [entries, query, sortBy, sortDir]);
  const paged = filtered.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  );
  const toggleSort = (field) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir("asc");
    }
  };
  return (
    <Box>
      <PageHeader
        title="Workspace activity"
        description="A timeline of your snapshots, source connections, and account activity."
      />

      {error && <Alert severity="error">{error}</Alert>}
      {entries === null && !error && (
        <Skeleton
          variant="rounded"
          sx={{
            height: 240,
          }}
        />
      )}

      {entries && entries.length === 0 && (
        <EmptyState
          icon={HistoryOutlinedIcon}
          title="Nothing here yet"
          description="Actions you take will show up here."
        />
      )}

      {entries && entries.length > 0 && (
        <>
          <SearchField
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(0);
            }}
            placeholder="Filter by action, target, or IP…"
            sx={{
              mb: 2,
            }}
          />
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell
                    sortDirection={sortBy === "action" ? sortDir : false}
                  >
                    <TableSortLabel
                      active={sortBy === "action"}
                      direction={sortBy === "action" ? sortDir : "asc"}
                      onClick={() => toggleSort("action")}
                    >
                      Action
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>IP</TableCell>
                  <TableCell
                    sortDirection={sortBy === "when" ? sortDir : false}
                  >
                    <TableSortLabel
                      active={sortBy === "when"}
                      direction={sortBy === "when" ? sortDir : "desc"}
                      onClick={() => toggleSort("when")}
                    >
                      When
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paged.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell>
                      <Chip
                        size="small"
                        label={e.action}
                        variant="outlined"
                        sx={{
                          fontFamily: (t) => t.tokens.fontMono,
                          fontWeight: 400,
                        }}
                      />
                    </TableCell>
                    <TableCell
                      sx={{
                        fontFamily: (t) => t.tokens.fontMono,
                      }}
                    >
                      {e.target_type ? `${e.target_type}:${e.target_id}` : "—"}
                    </TableCell>
                    <TableCell
                      sx={{
                        fontFamily: (t) => t.tokens.fontMono,
                      }}
                    >
                      {e.ip_address || "—"}
                    </TableCell>
                    <TableCell>{formatDate(e.created_at)}</TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      sx={{
                        textAlign: "center",
                        py: 4,
                        color: "text.secondary",
                      }}
                    >
                      No entries match "{query}".
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={filtered.length}
              page={page}
              onPageChange={(_e, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            />
          </TableContainer>
        </>
      )}
    </Box>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Skeleton from "@mui/material/Skeleton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import CloudQueueOutlinedIcon from "@mui/icons-material/CloudQueueOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useAuth } from "../context/AuthContext";
import { GitHubIcon } from "../components/BrandIcons";
import { formatDate } from "../lib/format";
import PageHeader from "../components/PageHeader";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import {
  encryptForTransit,
  isTransitEncryptionSupported,
} from "../api/transitCrypto";
import EmptyState from "../components/EmptyState";
const KIND_ICON = {
  mysql: DnsOutlinedIcon,
  postgres: DnsOutlinedIcon,
  mongo: StorageOutlinedIcon,
  storage: CloudQueueOutlinedIcon,
};
const KIND_LABEL = {
  mysql: "MySQL",
  postgres: "PostgreSQL",
  mongo: "MongoDB",
  storage: "Object storage",
};
function submitGithubManifest(githubUrl, manifest) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = githubUrl;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = JSON.stringify(manifest);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}
function ConnectionFormDialog({ kind, open, onClose, onSaved }) {
  const { request } = useAuth();
  const [name, setName] = useState("");
  const [storageType, setStorageType] = useState("s3");
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setName("");
      setFields({});
      setStorageType("s3");
      setError(null);
    }
  }, [open, kind]);
  const set = (patch) =>
    setFields((f) => ({
      ...f,
      ...patch,
    }));
  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Give this connection a name.");
      return;
    }
    let config;
    if (kind === "postgres") {
      config = {
        postgres_url: fields.postgres_url,
      };
    } else if (kind === "mysql") {
      config = { mysql_url: fields.mysql_url };
    } else if (kind === "mongo") {
      config = {
        mongo_url: fields.mongo_url,
        mongo_db_name: fields.mongo_db_name || undefined,
      };
    } else {
      config =
        storageType === "azure"
          ? {
              type: "azure",
              connection_string: fields.connection_string,
            }
          : {
              type: storageType,
              access_key_id: fields.access_key_id,
              secret_access_key: fields.secret_access_key,
              region: fields.region || "us-east-1",
              endpoint:
                storageType === "s3-compatible" ? fields.endpoint : undefined,
              bucket: fields.bucket || undefined,
            };
    }
    setSaving(true);
    try {
      const body = {
        name,
        kind,
      };
      if (!isTransitEncryptionSupported()) {
        throw new Error("Your browser cannot encrypt this connection. Open Contexa over HTTPS in a current browser and try again.");
      }
      body.transit_payload = await encryptForTransit(request, config);
      await request("/api/connections/", {
        method: "POST",
        body,
      });
      onSaved(name);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  if (!kind) return null;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>New {KIND_LABEL[kind]} connection</DialogTitle>
      <DialogContent>
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: "center",
            mb: 2,
          }}
        >
          <LockOutlinedIcon
            sx={{
              fontSize: 14,
              color: "text.secondary",
            }}
          />
          <Typography variant="caption">
            {isTransitEncryptionSupported()
              ? "Encrypted in your browser before it's sent, then re-encrypted at rest."
              : "Browser encryption is unavailable. Use HTTPS and a current browser to save a connection."}
          </Typography>
        </Stack>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            placeholder="prod-db"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            autoFocus
          />

          {kind === "postgres" && (
            <TextField
              label="Connection string"
              placeholder="postgresql://user:pass@host:5432/dbname"
              value={fields.postgres_url || ""}
              onChange={(e) =>
                set({
                  postgres_url: e.target.value,
                })
              }
              fullWidth
              required
            />
          )}

          {kind === "mysql" && <TextField label="Connection string" type="password" placeholder="mysql://user:password@host:3306/database" value={fields.mysql_url || ""} onChange={(e) => set({ mysql_url: e.target.value })} fullWidth required helperText="Use a schema-read-only database account. Remote connections require verified TLS." />}
          {kind === "mongo" && (
            <>
              <TextField
                label="Connection string"
                placeholder="mongodb+srv://user:pass@cluster.mongodb.net"
                value={fields.mongo_url || ""}
                onChange={(e) =>
                  set({
                    mongo_url: e.target.value,
                  })
                }
                fullWidth
                required
              />
              <TextField
                label="Database name"
                helperText="Required if not present in the connection string path."
                value={fields.mongo_db_name || ""}
                onChange={(e) =>
                  set({
                    mongo_db_name: e.target.value,
                  })
                }
                fullWidth
              />
            </>
          )}

          {kind === "storage" && (
            <>
              <TextField
                select
                label="Provider"
                value={storageType}
                onChange={(e) => setStorageType(e.target.value)}
                fullWidth
              >
                <MenuItem value="s3">Amazon S3</MenuItem>
                <MenuItem value="s3-compatible">S3-compatible</MenuItem>
                <MenuItem value="azure">Azure Blob Storage</MenuItem>
              </TextField>
              {storageType === "azure" ? (
                <TextField
                  label="Connection string"
                  placeholder="DefaultEndpointsProtocol=https;AccountName=..."
                  value={fields.connection_string || ""}
                  onChange={(e) =>
                    set({
                      connection_string: e.target.value,
                    })
                  }
                  fullWidth
                  required
                />
              ) : (
                <>
                  <TextField
                    label="Access key ID"
                    value={fields.access_key_id || ""}
                    onChange={(e) =>
                      set({
                        access_key_id: e.target.value,
                      })
                    }
                    fullWidth
                    required
                  />
                  <TextField
                    label="Secret access key"
                    type="password"
                    value={fields.secret_access_key || ""}
                    onChange={(e) =>
                      set({
                        secret_access_key: e.target.value,
                      })
                    }
                    fullWidth
                    required
                  />
                  <TextField
                    label="Bucket"
                    helperText="Leave blank to scan all accessible buckets."
                    value={fields.bucket || ""}
                    onChange={(e) =>
                      set({
                        bucket: e.target.value,
                      })
                    }
                    fullWidth
                  />
                  <TextField
                    label="Region"
                    value={fields.region || "us-east-1"}
                    onChange={(e) =>
                      set({
                        region: e.target.value,
                      })
                    }
                    fullWidth
                  />
                  {storageType === "s3-compatible" && (
                    <TextField
                      label="Endpoint"
                      placeholder="https://..."
                      value={fields.endpoint || ""}
                      onChange={(e) =>
                        set({
                          endpoint: e.target.value,
                        })
                      }
                      fullWidth
                      required
                    />
                  )}
                </>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          pb: 2,
        }}
      >
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          {saving ? <CircularProgress size={16} color="inherit" /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
export default function Connections() {
  const { request } = useAuth();
  const showToast = useToast();
  const [connections, setConnections] = useState(null);
  const [installations, setInstallations] = useState(null);
  const [error, setError] = useState(null);
  const [githubAppMissing, setGithubAppMissing] = useState(false);
  const [settingUpApp, setSettingUpApp] = useState(false);
  const [formKind, setFormKind] = useState(null);
  // { kind: "connection" | "installation", id, label } | null
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const reload = useCallback(() => {
    request("/api/connections/")
      .then(setConnections)
      .catch((e) => setError(e.message));
    request("/api/integrations/github/installations/")
      .then(setInstallations)
      .catch(() => setInstallations([]));
  }, [request]);
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);
  const confirmDelete = async () => {
    if (!confirmTarget) return;
    setConfirmBusy(true);
    try {
      const path =
        confirmTarget.kind === "connection"
          ? `/api/connections/${confirmTarget.id}/`
          : `/api/integrations/github/installations/${confirmTarget.id}/`;
      await request(path, {
        method: "DELETE",
      });
      showToast(
        confirmTarget.kind === "connection"
          ? "Connection deleted."
          : "Installation revoked.",
        "success",
      );
      reload();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setConfirmBusy(false);
      setConfirmTarget(null);
    }
  };
  const connectGithub = async () => {
    setError(null);
    setGithubAppMissing(false);
    try {
      const res = await request("/api/integrations/github/install-url/");
      window.open(res.install_url, "_blank", "noopener");
    } catch (e) {
      if (e.status === 503) setGithubAppMissing(true);
      else setError(e.message);
    }
  };
  const setUpGithubApp = async () => {
    setError(null);
    setSettingUpApp(true);
    try {
      const res = await request("/api/integrations/github/manifest/");
      submitGithubManifest(res.github_url, res.manifest);
    } catch (e) {
      setError(e.message);
      setSettingUpApp(false);
    }
  };
  return (
    <Box>
      <PageHeader
        title="Connected sources"
        description="Bring your stack together. Connect once, then choose these sources whenever you build a project snapshot."
      />

      <Alert severity="info" icon={<LockOutlinedIcon />} sx={{ mb: 3 }}>
        <Typography variant="subtitle2">How your connection credentials are protected</Typography>
        <Typography variant="body2">Database and storage credentials are encrypted in your browser before sending. Our database stores an encrypted copy, with the encryption key kept separately from the database. Saved credentials are never returned to your browser.</Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>Contexa decrypts credentials on the server when connecting to your source. Use a dedicated read-only account with access only to what you want to inspect. Prefer not to save connection credentials? Import a source ZIP or folder instead.</Typography>
      </Alert>

      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 3,
          }}
        >
          {error}
        </Alert>
      )}

      <Typography
        variant="subtitle2"
        sx={{
          mb: 1.5,
        }}
      >
        Your codebase
      </Typography>
      <Card
        variant="outlined"
        sx={{
          mb: 4,
        }}
      >
        <CardContent>
          {githubAppMissing && (
            <Alert
              severity="info"
              sx={{
                mb: 2,
              }}
            >
              This is a one-time, per-deployment setup step — someone needs to
              create the App on GitHub before anyone can install it. Requires a
              staff/admin account on this server.
              <Box
                sx={{
                  mt: 1.5,
                }}
              >
                <Button
                  size="small"
                  variant="contained"
                  startIcon={
                    settingUpApp ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <GitHubIcon />
                    )
                  }
                  onClick={setUpGithubApp}
                  disabled={settingUpApp}
                >
                  Create GitHub App
                </Button>
              </Box>
            </Alert>
          )}
          {installations === null ? (
            <Skeleton
              variant="rounded"
              sx={{
                height: 44,
              }}
            />
          ) : installations.length === 0 ? (
            <Stack
              direction={{
                xs: "column",
                sm: "row",
              }}
              spacing={2}
              sx={{
                alignItems: {
                  sm: "center",
                },
                justifyContent: "space-between",
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  maxWidth: 480,
                }}
              >
                Connect GitHub and choose the repositories you want Contexa to
                inspect on github.com — a short-lived token is minted fresh for
                each run, and access is revocable instantly from either side.
              </Typography>
              <Button
                variant="contained"
                startIcon={<GitHubIcon />}
                onClick={connectGithub}
                sx={{
                  flexShrink: 0,
                }}
              >
                Connect GitHub
              </Button>
            </Stack>
          ) : (
            <Stack spacing={1.5} divider={<Divider />}>
              {installations.map((i) => (
                <Stack
                  key={i.id}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{
                      alignItems: "center",
                    }}
                  >
                    <GitHubIcon />
                    <Box>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 600,
                        }}
                      >
                        {i.account_login}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        installation {i.installation_id} · connected{" "}
                        {formatDate(i.created_at)}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ flexWrap: "wrap", maxWidth: "100%" }}
                  >
                    <Button
                      size="small"
                      variant="outlined"
                      endIcon={<OpenInNewIcon fontSize="small" />}
                      href={`https://github.com/settings/installations/${i.installation_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Manage on GitHub
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      onClick={() =>
                        setConfirmTarget({
                          kind: "installation",
                          id: i.id,
                          label: i.account_login,
                        })
                      }
                    >
                      Revoke
                    </Button>
                  </Stack>
                </Stack>
              ))}
              <Box>
                <Button
                  size="small"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={connectGithub}
                >
                  Connect another GitHub account
                </Button>
              </Box>
            </Stack>
          )}
        </CardContent>
      </Card>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          mb: 1.5,
        }}
      >
        <Typography variant="subtitle2">Data-source connections</Typography>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: "wrap", maxWidth: "100%" }}
        >
          <Button
            size="small"
            variant="outlined"
            startIcon={<DnsOutlinedIcon fontSize="small" />}
            onClick={() => setFormKind("postgres")}
          >
            Postgres
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<StorageOutlinedIcon fontSize="small" />}
            onClick={() => setFormKind("mysql")}
          >
            MySQL
          </Button>
          <Button size="small" variant="outlined" startIcon={<StorageOutlinedIcon fontSize="small" />} onClick={() => setFormKind("mongo")}
          >
            MongoDB
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudQueueOutlinedIcon fontSize="small" />}
            onClick={() => setFormKind("storage")}
          >
            Storage
          </Button>
        </Stack>
      </Stack>

      {connections === null ? (
        <Skeleton
          variant="rounded"
          sx={{
            height: 60,
          }}
        />
      ) : connections.length === 0 ? (
        <EmptyState
          icon={StorageOutlinedIcon}
          title="No connections yet"
          description="Add a Postgres, MongoDB, or storage connection above to reuse across project snapshots."
        />
      ) : (
        <Stack spacing={1.25}>
          {connections.map((c) => {
            const KindIcon = KIND_ICON[c.kind] || StorageOutlinedIcon;
            return (
              <Card variant="outlined" key={c.id}>
                <CardContent
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 2,
                    "&:last-child": {
                      pb: 2,
                    },
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{
                      alignItems: "center",
                    }}
                  >
                    <Box
                      sx={{
                        width: 34,
                        height: 34,
                        borderRadius: 1.5,
                        bgcolor: "action.hover",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <KindIcon fontSize="small" />
                    </Box>
                    <Box>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                          alignItems: "center",
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                          }}
                        >
                          {c.name}
                        </Typography>
                        <Chip size="small" label={c.kind} variant="outlined" />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        added {formatDate(c.created_at)}
                        {c.last_used_at
                          ? ` · last used ${formatDate(c.last_used_at)}`
                          : " · never used"}
                      </Typography>
                    </Box>
                  </Stack>
                  <Tooltip title="Delete connection">
                    <IconButton
                      color="error"
                      size="small"
                      onClick={() =>
                        setConfirmTarget({
                          kind: "connection",
                          id: c.id,
                          label: c.name,
                        })
                      }
                      aria-label={`Delete ${c.name}`}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      <ConnectionFormDialog
        kind={formKind}
        open={!!formKind}
        onClose={() => setFormKind(null)}
        onSaved={(name) => {
          setFormKind(null);
          reload();
          showToast(`Connection "${name}" saved.`, "success");
        }}
      />

      <ConfirmDialog
        open={!!confirmTarget}
        title={
          confirmTarget?.kind === "connection"
            ? "Delete connection?"
            : "Revoke installation?"
        }
        description={
          confirmTarget?.kind === "connection"
            ? `Delete "${confirmTarget?.label}"? Any ingestion still referencing it will fail to run.`
            : `Revoke access for "${confirmTarget?.label}"? This also removes the App's access on GitHub's side immediately.`
        }
        confirmLabel={
          confirmTarget?.kind === "connection" ? "Delete" : "Revoke"
        }
        destructive
        loading={confirmBusy}
        onConfirm={confirmDelete}
        onClose={() => setConfirmTarget(null)}
      />
    </Box>
  );
}

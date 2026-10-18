import React, { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Tooltip from "@mui/material/Tooltip";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import CheckIcon from "@mui/icons-material/Check";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import { useAuth } from "../context/AuthContext";
import { API_BASE } from "../api/client";
import { copyToClipboard, formatDate } from "../lib/format";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastProvider";
function CopyField({ label, value, secret, helperText }) {
  const showToast = useToast();
  const [revealed, setRevealed] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyToClipboard(value)) {
      setCopied(true);
      showToast("Copied to clipboard.", "success");
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <TextField
      label={label}
      value={value}
      fullWidth
      helperText={helperText}
      slotProps={{
        input: {
          readOnly: true,
          type: secret && !revealed ? "password" : "text",
          sx: {
            fontFamily: (t) => t.tokens.fontMono,
            fontSize: 13,
          },
          endAdornment: (
            <InputAdornment position={"end"}>
              {secret && (
                <IconButton
                  size="small"
                  aria-label={revealed ? "Hide API token" : "Show API token"}
                  onClick={() => setRevealed((r) => !r)}
                  edge="end"
                >
                  {revealed ? (
                    <VisibilityOffOutlinedIcon fontSize="small" />
                  ) : (
                    <VisibilityOutlinedIcon fontSize="small" />
                  )}
                </IconButton>
              )}
              <Tooltip title={copied ? "Copied" : "Copy"}>
                <IconButton
                  size="small"
                  aria-label={`Copy ${label}`}
                  onClick={copy}
                  edge="end"
                >
                  {copied ? (
                    <CheckIcon fontSize="small" color="success" />
                  ) : (
                    <ContentCopyOutlinedIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
export default function Settings() {
  const { user, token, logout } = useAuth();
  return (
    <Box
      sx={{
        maxWidth: 640,
      }}
    >
      <PageHeader
        title="Settings"
        description="Account details and API access."
      />

      <Typography
        variant="subtitle2"
        sx={{
          mb: 1.5,
        }}
      >
        Account
      </Typography>
      <Card
        variant="outlined"
        sx={{
          mb: 4,
        }}
      >
        <CardContent>
          <Stack spacing={2} divider={<Divider />}>
            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
              }}
            >
              <Typography variant="body2" color="text.secondary">
                Username
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                }}
              >
                {user?.username}
              </Typography>
            </Stack>
            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
              }}
            >
              <Typography variant="body2" color="text.secondary">
                Email
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                }}
              >
                {user?.email || "—"}
              </Typography>
            </Stack>
            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
              }}
            >
              <Typography variant="body2" color="text.secondary">
                Member since
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                }}
              >
                {formatDate(user?.date_joined)}
              </Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Typography
        variant="subtitle2"
        sx={{
          mb: 1.5,
        }}
      >
        API access
      </Typography>
      <Card
        variant="outlined"
        sx={{
          mb: 4,
        }}
      >
        <CardContent>
          <Alert
            severity="info"
            sx={{
              mb: 2.5,
            }}
          >
            Used to connect the Contexa MCP server to your account so Claude
            Code/Desktop can call
            <code
              style={{
                margin: "0 4px",
              }}
            >
              get_context
            </code>
            , <code>run_ingestion</code>, and the other tools directly. Set
            these as <code>CONTEXA_API_URL</code> and{" "}
            <code>CONTEXA_API_TOKEN</code> in the MCP server's environment.
          </Alert>
          <Stack spacing={2.5}>
            <CopyField label="API base URL" value={API_BASE} />
            <CopyField
              label="API token"
              value={token}
              secret
              helperText="Treat this like a password — anyone with it can act as you via the API."
            />
          </Stack>
        </CardContent>
      </Card>

      <Typography
        variant="subtitle2"
        sx={{
          mb: 1.5,
          color: "text.secondary",
        }}
      >
        Session
      </Typography>
      <Card
        variant="outlined"
        sx={{
          borderColor: "divider",
        }}
      >
        <CardContent
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
              }}
            >
              Log out
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Ends your session on this device. Your data stays intact.
            </Typography>
          </Box>
          <Button
            color="inherit"
            variant="outlined"
            startIcon={<LogoutOutlinedIcon />}
            onClick={logout}
          >
            Log out
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}

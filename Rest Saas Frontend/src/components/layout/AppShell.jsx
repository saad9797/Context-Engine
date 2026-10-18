import React, { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Avatar from "@mui/material/Avatar";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import SpaceDashboardOutlinedIcon from "@mui/icons-material/SpaceDashboardOutlined";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CableOutlinedIcon from "@mui/icons-material/CableOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import BrandLogo from "../Brand";
import PageTransition from "../PageTransition";
import { useAuth } from "../../context/AuthContext";
import { useThemeMode } from "../../context/ThemeModeContext";
const DRAWER_WIDTH = 248;
const RAIL_WIDTH = 68;
const NAV_ITEMS = [
  {
    to: "/dashboard",
    label: "Project library",
    icon: SpaceDashboardOutlinedIcon,
  },
  {
    to: "/ingest/new",
    label: "Build a snapshot",
    icon: AddCircleOutlineIcon,
  },
  {
    to: "/connections",
    label: "Connected sources",
    icon: CableOutlinedIcon,
  },
  {
    to: "/audit-log",
    label: "Activity",
    icon: HistoryOutlinedIcon,
  },
];
function readStoredCollapsed() {
  try {
    return localStorage.getItem("cxa_sidebar_collapsed") === "1";
  } catch {
    return false;
  }
}
function Brand({ collapsed }) {
  return (
    <Box
      sx={{
        px: collapsed ? 0 : 1,
        display: "flex",
        justifyContent: collapsed ? "center" : "flex-start",
      }}
    >
      <BrandLogo compact={collapsed} />
    </Box>
  );
}
function NavItem({ item, collapsed, onNavigate }) {
  const button = (
    <ListItemButton
      component={NavLink}
      to={item.to}
      onClick={onNavigate}
      sx={{
        borderRadius: 1.5,
        minHeight: 36,
        flexGrow: 0,
        flexShrink: 0,
        justifyContent: collapsed ? "center" : "flex-start",
        px: collapsed ? 0 : 1.25,
        color: "text.secondary",
        mb: 0.5,
        "&.active": {
          bgcolor: "action.selected",
          color: "primary.main",
          "& .MuiListItemIcon-root": {
            color: "primary.main",
          },
        },
        "&:hover": {
          bgcolor: "action.hover",
        },
      }}
    >
      <ListItemIcon
        sx={{
          minWidth: collapsed ? "auto" : 32,
          color: "inherit",
        }}
      >
        <item.icon
          sx={{
            fontSize: 18,
          }}
        />
      </ListItemIcon>
      {!collapsed && (
        <ListItemText
          slotProps={{
            primary: { sx: { fontSize: "0.8125rem", fontWeight: 500 } },
          }}
        >
          {item.label}
        </ListItemText>
      )}
    </ListItemButton>
  );
  return collapsed ? (
    <Tooltip title={item.label} placement="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
function SidebarContent({
  onNavigate,
  collapsed,
  onToggleCollapsed,
  showCollapseToggle,
}) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        py: 3,
        px: 2,
      }}
    >
      <Box
        sx={{
          mb: 3,
          minHeight: 28,
        }}
      >
        <Brand collapsed={collapsed} />
      </Box>
      {!collapsed && (
        <Typography
          variant="overline"
          sx={{
            px: 1.25,
            mb: 1.5,
            color: "text.secondary",
            fontSize: 9,
            letterSpacing: 1.3,
          }}
        >
          PERSONAL WORKSPACE
        </Typography>
      )}
      <List
        component="nav"
        aria-label="Workspace navigation"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
          p: 0,
        }}
      >
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </List>
      {!collapsed && (
        <Box
          sx={{
            p: 2,
            mb: 2,
            bgcolor: "action.hover",
            borderRadius: 2,
          }}
        >
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 600,
              mb: 0.75,
            }}
          >
            A better starting point.
          </Typography>
          <Typography
            variant="caption"
            sx={{
              fontSize: 10,
              lineHeight: 1.7,
            }}
          >
            Connect your stack. Build a snapshot. Give your AI the context it
            needs.
          </Typography>
        </Box>
      )}
      <Divider
        sx={{
          my: 1,
        }}
      />
      <NavItem
        item={{
          to: "/settings",
          label: "Settings",
          icon: SettingsOutlinedIcon,
        }}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      {showCollapseToggle && (
        <Tooltip
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          placement="right"
        >
          <IconButton
            size="small"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapsed}
            sx={{
              mt: 1,
              alignSelf: collapsed ? "center" : "flex-end",
              color: "text.secondary",
            }}
          >
            {collapsed ? (
              <ChevronRightIcon fontSize="small" />
            ) : (
              <ChevronLeftIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
export default function AppShell() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const [anchorEl, setAnchorEl] = useState(null);
  const { user, logout } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
  const currentSection = location.pathname.startsWith("/contexts/")
    ? "Project snapshot"
    : location.pathname.includes("/progress")
      ? "Building snapshot"
      : {
          "/dashboard": "Project library",
          "/ingest/new": "Build a snapshot",
          "/connections": "Connected sources",
          "/audit-log": "Activity",
          "/settings": "Settings",
        }[location.pathname] || "Workspace";
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("cxa_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const handleLogout = async () => {
    setAnchorEl(null);
    await logout();
    navigate("/login", {
      replace: true,
    });
  };
  const initial = (user?.username || "?").slice(0, 1).toUpperCase();
  const sidebarWidth = collapsed ? RAIL_WIDTH : DRAWER_WIDTH;
  return (
    <Box
      className="app-shell"
      sx={{
        display: "flex",
        minHeight: "100vh",
      }}
    >
      {isMobile ? (
        <>
          <AppBar
            color="inherit"
            elevation={0}
            sx={{
              position: "fixed",
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Toolbar
              sx={{
                gap: 1,
              }}
            >
              <IconButton
                edge="start"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <MenuIcon />
              </IconButton>
              <Box
                sx={{
                  flex: 1,
                }}
              >
                <Brand />
              </Box>
            </Toolbar>
          </AppBar>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{
              keepMounted: true,
            }}
            sx={{
              "& .MuiDrawer-paper": {
                width: DRAWER_WIDTH,
              },
            }}
          >
            <SidebarContent
              onNavigate={() => setMobileOpen(false)}
              collapsed={false}
              showCollapseToggle={false}
            />
          </Drawer>
        </>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            transition: theme.transitions.create("width", {
              duration: 180,
            }),
            "& .MuiDrawer-paper": {
              width: sidebarWidth,
              boxSizing: "border-box",
              borderRight: 1,
              borderColor: "divider",
              bgcolor: "action.hover",
              overflowX: "hidden",
              transition: theme.transitions.create("width", {
                duration: 180,
              }),
            },
          }}
        >
          <SidebarContent
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            showCollapseToggle
          />
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          mt: isMobile ? 7 : 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 0.5,
            px: {
              xs: 2.5,
              md: 4,
            },
            py: 1.5,
            minHeight: 64,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <div className="workspace-breadcrumb">
            Workspace <span>/</span>
            <strong>{currentSection}</strong>
            <div className="workspace-tag">Personal</div>
          </div>
          <Tooltip
            title={
              mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            <IconButton
              size="small"
              onClick={toggleMode}
              aria-label="Toggle color mode"
            >
              {mode === "dark" ? (
                <LightModeOutlinedIcon fontSize="small" />
              ) : (
                <DarkModeOutlinedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title={user?.username || "Account"}>
            <IconButton
              size="small"
              onClick={(e) => setAnchorEl(e.currentTarget)}
              aria-label="Account menu"
            >
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  fontSize: 12,
                  bgcolor: "action.hover",
                  color: "text.primary",
                }}
              >
                {initial}
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={anchorEl}
            open={!!anchorEl}
            onClose={() => setAnchorEl(null)}
            anchorOrigin={{
              vertical: "bottom",
              horizontal: "right",
            }}
            transformOrigin={{
              vertical: "top",
              horizontal: "right",
            }}
          >
            <Box
              sx={{
                px: 2,
                py: 1,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                }}
              >
                {user?.username}
              </Typography>
              {user?.email && (
                <Typography variant="caption">{user.email}</Typography>
              )}
            </Box>
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogoutOutlinedIcon fontSize="small" />
              </ListItemIcon>
              Log out
            </MenuItem>
          </Menu>
        </Box>

        <Box
          sx={{
            px: {
              xs: 2.5,
              md: 5,
            },
            py: {
              xs: 3,
              md: 4.5,
            },
            maxWidth: 1280,
            mx: "auto",
          }}
        >
          <PageTransition workspace />
        </Box>
      </Box>
    </Box>
  );
}

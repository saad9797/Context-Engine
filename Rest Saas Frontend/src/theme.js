import { createTheme, alpha } from "@mui/material/styles";

/* ============================================================================
   DESIGN TOKENS
   ----------------------------------------------------------------------------
   Single source of truth for color, type, and spacing. Every page reads
   these through the MUI theme (palette.*, typography variants, theme.spacing)
   rather than hardcoding values — that's what keeps 30+ files visually
   consistent without a shared component library beyond MUI itself.
============================================================================ */

// Neutral gray scale carries ~90% of the UI (backgrounds, borders, body
// text). Zinc rather than a blue-tinted gray (e.g. Tailwind's "slate") so it
// doesn't fight with the indigo accent below.
const gray = {
  0: "#FFFFFF",
  25: "#FCFCFD",
  50: "#F9F9FA",
  100: "#F2F2F4",
  150: "#EAEAED",
  200: "#E1E1E5",
  300: "#CBCBD1",
  400: "#9C9CA6",
  500: "#71717A",
  600: "#52525B",
  700: "#3F3F46",
  800: "#27272A",
  850: "#1C1C1F",
  900: "#18181B",
  950: "#0E0E10",
};

// One accent, used only for primary actions/links/focus/active-state —
// never for decoration. Indigo rather than a pure blue so it reads
// distinctly from the "info" semantic color below.
const indigo = { 50: "#EEF2FF", 100: "#E0E3FF", 300: "#A5AEFB", 400: "#828DF8", 500: "#5B63F0", 600: "#4A4FE0", 700: "#3E3FC4", 800: "#3532A0" };

// Semantic — status only, never decorative.
const blue = { 50: "#EFF6FF", 500: "#3B82F6", 600: "#2563EB", 700: "#1D4ED8" };
const green = { 50: "#EFFAF3", 500: "#22B573", 600: "#188C58", 700: "#0F6E44" };
const amber = { 50: "#FFF8EB", 500: "#E9A319", 600: "#C1830E", 700: "#8F5E09" };
const red = { 50: "#FEF2F2", 500: "#EF4444", 600: "#DC2626", 700: "#B42318" };

// 4px base grid — pass these as MUI spacing units (theme.spacing(1) === 4px)
// so every `sx={{ p: n }}` in the app lands on 4/8/12/16/24/32/48 by
// construction instead of by convention.
const SPACING_UNIT = 4;

const FONT_BODY = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
// System monospace stack — no webfont fetch, and every OS's default mono
// face (SF Mono / Cascadia / Menlo) already reads cleanly at 13px.
const FONT_MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

function buildPalette(mode) {
  const isDark = mode === "dark";
  return {
    mode,
    primary: {
      main: isDark ? indigo[400] : indigo[600],
      light: isDark ? indigo[300] : indigo[500],
      dark: isDark ? indigo[500] : indigo[700],
      contrastText: "#FFFFFF",
    },
    // No secondary accent — components that previously used `color="secondary"`
    // for anything non-informational are being moved to neutral in the page
    // pass. `secondary` itself still resolves to something sane (a muted
    // version of primary) for any MUI internals that assume it exists.
    secondary: { main: isDark ? indigo[300] : indigo[700], contrastText: "#FFFFFF" },
    info: { main: isDark ? blue[500] : blue[600], light: blue[50], dark: blue[700] },
    success: { main: isDark ? green[500] : green[600], light: green[50], dark: green[700] },
    warning: { main: isDark ? amber[500] : amber[600], light: amber[50], dark: amber[700] },
    error: { main: isDark ? red[500] : red[600], light: red[50], dark: red[700] },
    background: {
      // Dark mode is its own composition, not `background.default` inverted:
      // near-black canvas, a slightly lighter surface for cards, and an
      // even lighter one for popovers/menus — three distinct steps, same as
      // light mode's white-canvas / white-card-on-gray / raised-menu.
      default: isDark ? gray[950] : gray[25],
      paper: isDark ? gray[900] : gray[0],
    },
    text: {
      primary: isDark ? gray[50] : gray[900],
      secondary: isDark ? gray[400] : gray[500],
      disabled: isDark ? gray[700] : gray[300],
    },
    divider: isDark ? alpha(gray[400], 0.16) : gray[150],
    action: {
      hover: isDark ? alpha(gray[300], 0.06) : gray[50],
      selected: isDark ? alpha(indigo[400], 0.16) : indigo[50],
      disabled: isDark ? gray[700] : gray[300],
      disabledBackground: isDark ? gray[850] : gray[100],
      focus: isDark ? alpha(indigo[400], 0.3) : alpha(indigo[600], 0.3),
    },
    grey: gray,
    divider2: isDark ? gray[850] : gray[100], // "surface-raised" border — see components below
  };
}

export function buildTheme(mode = "light") {
  const isDark = mode === "dark";
  const palette = buildPalette(mode);
  const focusRing = `0 0 0 3px ${alpha(palette.primary.main, 0.28)}`;

  const theme = createTheme({
    palette,
    spacing: SPACING_UNIT,
    shape: { borderRadius: 10 }, // card radius; buttons/inputs override to 6, dialogs to 14 below
    typography: {
      fontFamily: FONT_BODY,
      fontWeightLight: 400,
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 600, // capped at 600 — no 700/800 weights anywhere in the app
      // h1-h3 are marketing-page-only (landing page headlines) — the app
      // itself never goes above h4 (page title).
      h1: { fontSize: "3rem", lineHeight: "3.5rem", fontWeight: 600, letterSpacing: "-0.02em" },
      h2: { fontSize: "2.25rem", lineHeight: "2.75rem", fontWeight: 600, letterSpacing: "-0.015em" },
      h3: { fontSize: "1.75rem", lineHeight: "2.25rem", fontWeight: 600, letterSpacing: "-0.01em" },
      // Page title
      h4: { fontSize: "1.5rem", lineHeight: "2rem", fontWeight: 600, letterSpacing: "-0.01em" },
      h5: { fontSize: "1.25rem", lineHeight: "1.75rem", fontWeight: 600, letterSpacing: "-0.01em" },
      // Section title
      h6: { fontSize: "1.125rem", lineHeight: "1.75rem", fontWeight: 600, letterSpacing: "-0.01em" },
      subtitle1: { fontSize: "1rem", lineHeight: "1.5rem", fontWeight: 500 },
      subtitle2: { fontSize: "0.8125rem", lineHeight: "1.25rem", fontWeight: 600, color: palette.text.secondary },
      // Body
      body1: { fontSize: "0.875rem", lineHeight: "1.375rem", fontWeight: 400 },
      // Secondary text
      body2: { fontSize: "0.8125rem", lineHeight: "1.25rem", fontWeight: 400, color: palette.text.secondary },
      // Caption
      caption: { fontSize: "0.75rem", lineHeight: "1rem", fontWeight: 400, color: palette.text.secondary },
      // Tiny table headers/labels — the one place all-caps is used, and only here
      overline: { fontSize: "0.6875rem", lineHeight: "1rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" },
      button: { fontWeight: 500, textTransform: "none", fontSize: "0.875rem" },
    },
    shadows: [
      "none",
      // Menus/popovers/dialogs only — everything else uses a 1px border.
      isDark ? "0 4px 16px rgba(0,0,0,0.4)" : "0 4px 16px rgba(20,20,25,0.08)",
      isDark ? "0 8px 24px rgba(0,0,0,0.45)" : "0 8px 24px rgba(20,20,25,0.10)",
      ...Array(22).fill(isDark ? "0 12px 32px rgba(0,0,0,0.5)" : "0 12px 32px rgba(20,20,25,0.12)"),
    ],
    transitions: {
      duration: { shortest: 120, shorter: 150, short: 180, standard: 200, complex: 200 },
    },
  });

  theme.components = {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: palette.background.default },
        // Global motion budget: nothing above 200ms, and honor the OS
        // reduced-motion preference by collapsing everything to near-zero.
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.001ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.001ms !important",
            scrollBehavior: "auto !important",
          },
        },
      },
    },

    // ─── Buttons ──────────────────────────────────────────────────────────
    // primary = contained, secondary = outlined ("secondary" in the spec's
    // sense of "second in visual weight", not MUI's `color="secondary"`),
    // tertiary = text, destructive = color="error".
    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: false },
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
          minHeight: 36,
          paddingInline: 14,
          transition: "background-color 150ms ease, border-color 150ms ease, color 150ms ease",
          "&:focus-visible": { boxShadow: focusRing },
        },
        sizeSmall: { minHeight: 32, paddingInline: 10, fontSize: "0.8125rem" },
        sizeLarge: { minHeight: 40, paddingInline: 18 },
        outlined: { borderColor: palette.divider, "&:hover": { borderColor: isDark ? gray[500] : gray[300], backgroundColor: palette.action.hover } },
        outlinedInherit: { borderColor: palette.divider, color: palette.text.primary },
        text: { color: palette.text.secondary, "&:hover": { backgroundColor: palette.action.hover, color: palette.text.primary } },
        containedPrimary: { "&:hover": { backgroundColor: palette.primary.dark } },
      },
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: false },
      styleOverrides: { root: { "&.Mui-focusVisible": { boxShadow: focusRing } } },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 6, "&:focus-visible": { boxShadow: focusRing } } },
    },

    // ─── Inputs ───────────────────────────────────────────────────────────
    // Label rendered above the field (not floating inside the border) —
    // achieved by pinning MuiInputLabel to static flow above the input and
    // hiding the notch a floating label would otherwise cut into the border.
    MuiTextField: { defaultProps: { size: "small", InputLabelProps: { shrink: true } } },
    MuiFormControl: { defaultProps: { size: "small" } },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          position: "static",
          transform: "none",
          marginBottom: 6,
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: palette.text.primary,
          "&.Mui-focused": { color: palette.text.primary },
          "&.Mui-error": { color: palette.error.main },
        },
        asterisk: { color: palette.error.main },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          backgroundColor: palette.background.paper,
          fontSize: "0.875rem",
          "& .MuiOutlinedInput-notchedOutline": { borderColor: palette.divider, top: 0 },
          "& .MuiOutlinedInput-notchedOutline legend": { display: "none" }, // no notch — label sits above
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: isDark ? gray[500] : gray[300] },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: palette.primary.main, borderWidth: 1 },
          "&.Mui-focused": { boxShadow: focusRing },
          "&.Mui-error.Mui-focused": { boxShadow: `0 0 0 3px ${alpha(palette.error.main, 0.24)}` },
          "&.Mui-disabled": { backgroundColor: isDark ? gray[850] : gray[50] },
        },
        input: { padding: "9px 12px" }, // ~40px total row height at 14px/1.375 line-height + 1px border
        notchedOutline: { borderColor: palette.divider },
      },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { marginLeft: 0, marginTop: 6, fontSize: "0.75rem" }, contained: { marginLeft: 0 } },
    },
    MuiSelect: { defaultProps: { size: "small" } },
    MuiMenuItem: { styleOverrides: { root: { fontSize: "0.875rem", borderRadius: 4, marginInline: 4, minHeight: 36 } } },
    MuiCheckbox: { styleOverrides: { root: { "&.Mui-focusVisible": { boxShadow: focusRing, borderRadius: 4 } } } },
    MuiSwitch: {
      styleOverrides: {
        root: { padding: 8 },
        switchBase: { "&.Mui-focusVisible": { boxShadow: focusRing, borderRadius: "50%" } },
      },
    },

    // ─── Surfaces ─────────────────────────────────────────────────────────
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none", backgroundColor: palette.background.paper },
        outlined: { borderColor: palette.divider },
      },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: { borderRadius: 10, borderColor: palette.divider, boxShadow: "none" },
      },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 20, "&:last-child": { paddingBottom: 20 } } },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: { padding: "16px 20px", borderBottom: `1px solid ${palette.divider}` },
        title: { fontSize: "0.9375rem", fontWeight: 600 },
        subheader: { fontSize: "0.8125rem", color: palette.text.secondary },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: palette.divider } } },

    // ─── Tables ───────────────────────────────────────────────────────────
    // Dense 44px rows, sticky header (opt-in per <Table stickyHeader />,
    // themed here), right-aligned numeric columns and monospace identifiers
    // are per-usage (content-dependent) conventions applied at the page level.
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: palette.divider, padding: "10px 16px", fontSize: "0.8125rem" },
        head: { fontSize: "0.75rem", fontWeight: 600, color: palette.text.secondary, backgroundColor: palette.background.paper },
        stickyHeader: { backgroundColor: palette.background.paper },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { "&:last-of-type td": { borderBottom: "none" } },
        hover: { "&:hover": { backgroundColor: palette.action.hover } },
      },
    },

    // ─── Tabs ─────────────────────────────────────────────────────────────
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40, borderBottom: `1px solid ${palette.divider}` },
        indicator: { height: 2, borderRadius: 1 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 500,
          fontSize: "0.875rem",
          minHeight: 40,
          padding: "8px 4px",
          marginRight: 24,
          minWidth: "auto",
          color: palette.text.secondary,
          "&.Mui-selected": { color: palette.text.primary, fontWeight: 600 },
          "&:focus-visible": { boxShadow: focusRing, borderRadius: 4 },
        },
      },
    },

    // ─── Chips / badges ───────────────────────────────────────────────────
    // Low-saturation fill + matching darker text per status; theme-provided
    // via the `color` prop so pages never hand-roll chip colors.
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 500, fontSize: "0.75rem", height: 24 },
        outlined: { borderColor: palette.divider },
        colorSuccess: { backgroundColor: alpha(palette.success.main, isDark ? 0.18 : 0.12), color: isDark ? green[500] : green[700] },
        colorWarning: { backgroundColor: alpha(palette.warning.main, isDark ? 0.18 : 0.12), color: isDark ? amber[500] : amber[700] },
        colorError: { backgroundColor: alpha(palette.error.main, isDark ? 0.18 : 0.12), color: isDark ? red[500] : red[700] },
        colorInfo: { backgroundColor: alpha(palette.info.main, isDark ? 0.18 : 0.12), color: isDark ? blue[500] : blue[700] },
        colorPrimary: { backgroundColor: alpha(palette.primary.main, isDark ? 0.2 : 0.1), color: palette.primary.main },
      },
    },

    // ─── Overlays: dialogs, menus, tooltips, snackbars ───────────────────
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 14, backgroundImage: "none" },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: "1.0625rem", fontWeight: 600, padding: "20px 24px 8px" } } },
    MuiDialogContent: { styleOverrides: { root: { padding: "8px 24px" } } },
    MuiDialogActions: { styleOverrides: { root: { padding: "16px 24px 20px" } } },
    MuiPopover: { styleOverrides: { paper: { borderRadius: 10, border: `1px solid ${palette.divider}` } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: 10, border: `1px solid ${palette.divider}` } } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: isDark ? gray[100] : gray[900],
          color: isDark ? gray[900] : gray[0],
          fontSize: "0.75rem",
          fontWeight: 500,
          borderRadius: 6,
          padding: "6px 10px",
        },
        arrow: { color: isDark ? gray[100] : gray[900] },
      },
    },
    MuiSnackbarContent: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, fontSize: "0.8125rem", border: "1px solid transparent" },
        standardSuccess: { backgroundColor: alpha(palette.success.main, isDark ? 0.16 : 0.08), borderColor: alpha(palette.success.main, 0.24), color: isDark ? green[500] : green[700] },
        standardWarning: { backgroundColor: alpha(palette.warning.main, isDark ? 0.16 : 0.08), borderColor: alpha(palette.warning.main, 0.24), color: isDark ? amber[500] : amber[700] },
        standardError: { backgroundColor: alpha(palette.error.main, isDark ? 0.16 : 0.08), borderColor: alpha(palette.error.main, 0.24), color: isDark ? red[500] : red[700] },
        standardInfo: { backgroundColor: alpha(palette.info.main, isDark ? 0.16 : 0.08), borderColor: alpha(palette.info.main, 0.24), color: isDark ? blue[500] : blue[700] },
      },
    },

    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4, height: 6, backgroundColor: palette.action.hover } } },
    MuiSkeleton: { styleOverrides: { root: { backgroundColor: palette.action.hover } } },
    MuiAvatar: { styleOverrides: { root: { fontSize: "0.8125rem", fontWeight: 500 } } },
  };

  // Exposed for components that need raw values outside `sx` (e.g. inline
  // SVG fills in the architecture diagram) — keeps every hardcoded color in
  // the app traceable back to this one file.
  theme.tokens = { gray, indigo, blue, green, amber, red, fontMono: FONT_MONO };

  return theme;
}

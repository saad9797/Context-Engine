import React, { createContext, useContext, useMemo, useState } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { buildTheme } from "../theme";

const ThemeModeContext = createContext(null);

function readStoredMode() {
  try {
    const stored = localStorage.getItem("cxa_theme_mode");
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* ignore */ }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

export function ThemeModeProvider({ children }) {
  const [mode, setMode] = useState(readStoredMode);

  const toggleMode = () => {
    setMode((m) => {
      const next = m === "light" ? "dark" : "light";
      try { localStorage.setItem("cxa_theme_mode", next); } catch { /* ignore */ }
      return next;
    });
  };

  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeModeProvider");
  return ctx;
}

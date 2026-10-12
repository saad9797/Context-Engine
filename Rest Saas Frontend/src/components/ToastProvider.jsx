import React, { createContext, useCallback, useContext, useState } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { message, severity }

  const showToast = useCallback((message, severity = "success") => {
    setToast({ message, severity, key: Date.now() });
  }, []);

  const close = () => setToast((t) => (t ? { ...t, open: false } : t));

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <Snackbar
        key={toast?.key}
        open={!!toast}
        autoHideDuration={4000}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        TransitionProps={{ timeout: 180 }}
      >
        {toast ? (
          <Alert onClose={close} severity={toast.severity} variant="standard" sx={{ minWidth: 280 }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

// Returns a `showToast(message, severity)` function — severity defaults to
// "success"; pass "error" | "info" | "warning" as needed.
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

import React, { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import "./page-transition.css";

export function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="page-loading-mark" aria-hidden="true"><i /><i /><i /></span>
      <span>Loading Contexa…</span>
    </div>
  );
}

export default function PageTransition({ workspace = false }) {
  const { pathname } = useLocation();
  return (
    <Suspense fallback={<PageLoading />}>
      {/* Path changes restart the entrance; filters and anchor links keep their state. */}
      <div key={pathname} className={`page-transition${workspace ? " page-transition-workspace" : ""}`}>
        <Outlet />
      </div>
    </Suspense>
  );
}

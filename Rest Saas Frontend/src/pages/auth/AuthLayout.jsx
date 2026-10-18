import React from "react";
import { Link } from "react-router-dom";
import Brand from "../../components/Brand";
import Check from "@mui/icons-material/Check";
export default function AuthLayout({ children }) {
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand />
        <div className="auth-story-content">
          <div className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</div>
          <h2>
            Your project makes
            <br />
            more sense here.
          </h2>
          <p>
            See how everything connects. Take precise context into your next AI
            session.
          </p>
          <div className="auth-context-card">
            <div className="auth-context-header">
              <span>project-context.json</span>
              <span className="green-dot" />
            </div>
            <pre>{`{\n  "your_project": {\n    "codebase": "understood",\n    "architecture": "connected",\n    "context": "ready to build"\n  }\n}`}</pre>
            <div className="auth-context-foot">
              <Check sx={{ fontSize: 13 }} /> Less explaining. More building.
            </div>
          </div>
        </div>
        <div className="auth-story-footer">
          Your stack. Your AI tools. A clearer starting point.
        </div>
      </aside>
      <main className="auth-form-area">
        <Link className="auth-back" to="/">
          ← Back to home
        </Link>
        <div className="auth-form-inner">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

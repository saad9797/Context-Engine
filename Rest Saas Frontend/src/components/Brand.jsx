import React from "react";
import { Link } from "react-router-dom";
export default function Brand({ compact = false, inverse = false }) {
  return (
    <Link
      to="/"
      className={`brand${inverse ? " brand-inverse" : ""}`}
      aria-label="Contexa home"
    >
      <svg
        width="30"
        height="30"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="9" fill="currentColor" />
        <path
          d="m10 10 6-3 6 3v6l-6 3-6-3v-6Z"
          stroke="var(--brand-cutout, #fff)"
          strokeWidth="1.5"
        />
        <path
          d="m10 16-3 2v6l6 3 6-3v-6m-9-8 6 3 6-3m-6 3v6"
          stroke="var(--brand-cutout, #fff)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && (
        <span>
          contexa<span className="brand-period">.</span>
        </span>
      )}
    </Link>
  );
}

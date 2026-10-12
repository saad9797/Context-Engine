import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatusBadge from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the default label for a known status", () => {
    render(<StatusBadge status="succeeded" />);
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
  });

  it("renders a custom label when given one, overriding the default", () => {
    render(<StatusBadge status="fresh" label="No drift (2h old)" />);
    expect(screen.getByText("No drift (2h old)")).toBeInTheDocument();
    expect(screen.queryByText("Fresh")).not.toBeInTheDocument();
  });

  it("falls back to the unknown status rather than crashing on a bad status key", () => {
    // A typo'd or future/unmapped status string must not throw — this is
    // exactly the kind of "malformed API response hits an unguarded
    // render" case the app previously had no ErrorBoundary for either.
    render(<StatusBadge status="some_future_status_not_in_the_map" />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders every documented status without throwing", () => {
    const statuses = ["succeeded", "fresh", "running", "pending", "drifted", "failed", "unknown"];
    for (const status of statuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      unmount();
    }
  });
});

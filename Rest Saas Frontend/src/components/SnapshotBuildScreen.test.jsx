import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SnapshotBuildScreen from "./SnapshotBuildScreen";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("previews only selected sources and never invents completion", () => {
  vi.useFakeTimers();
  render(<SnapshotBuildScreen open database projectName="Orbit" />);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Building your snapshot");
  act(() => vi.advanceTimersByTime(5500));
  expect(screen.getByRole("status")).toHaveTextContent("Reading database tables");
  act(() => vi.advanceTimersByTime(120000));
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for your saved snapshot");
  expect(screen.queryByText(/MongoDB|repository source|storage metadata/)).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
});

it("cleans up its timer and resets when another request starts", () => {
  vi.useFakeTimers();
  const { rerender, unmount } = render(<SnapshotBuildScreen open repository />);
  act(() => vi.advanceTimersByTime(11000));
  rerender(<SnapshotBuildScreen open={false} repository />);
  expect(vi.getTimerCount()).toBeLessThan(3); // MUI also schedules exit transitions.
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<SnapshotBuildScreen open repository />);
  expect(screen.getByRole("status")).toHaveTextContent("Connecting to your selected sources");
  unmount();
  act(() => vi.runOnlyPendingTimers());
  expect(vi.getTimerCount()).toBe(0);
});

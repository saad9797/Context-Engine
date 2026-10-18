import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IngestionProgress from "./IngestionProgress";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ request }) }));

function mount() {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/ingest/job-1/progress",
          state: {
            projectName: "Orbit",
            sourcesEnabled: { database: true, mongo_database: true },
          },
        },
      ]}
    >
      <Routes>
        <Route path="/ingest/:jobId/progress" element={<IngestionProgress />} />
        <Route
          path="/contexts/:id"
          element={<div>Finished project overview</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}
async function settle() {
  await act(async () => {});
}

describe("Snapshot build experience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    request.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("uses real progress and treats emitted source stages as finished inspections", async () => {
    request.mockResolvedValue({
      status: "running",
      stage: "postgres",
      progress_pct: 20,
    });
    mount();
    await settle();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
    expect(
      screen.getByRole("heading", {
        name: "Making sense of your collections.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Index your repository")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
  });

  it("keeps queued jobs on standby instead of portraying active work", async () => {
    request.mockResolvedValue({
      status: "pending",
      stage: "",
      progress_pct: 0,
    });
    const { container } = mount();
    await settle();
    expect(
      screen.getByRole("heading", { name: "Your snapshot is in line." }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".build-visualization-queued"),
    ).toBeInTheDocument();
    expect(container.querySelector(".build-wire-flow")).not.toBeInTheDocument();
  });

  it("waits for a saved result even when the worker reports 100 percent", async () => {
    request.mockResolvedValue({
      status: "running",
      stage: "finalizing",
      progress_pct: 100,
    });
    mount();
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(
      screen.getByRole("heading", {
        name: "Putting the finishing touches on it.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Finished project overview"),
    ).not.toBeInTheDocument();
  });

  it("shows the finished snapshot before transitioning to the result", async () => {
    request.mockResolvedValue({
      status: "succeeded",
      stage: "complete",
      progress_pct: 100,
      result: 42,
    });
    mount();
    await settle();
    expect(
      screen.getByRole("heading", { name: "Your project, in perspective." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Finished project overview"),
    ).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(screen.getByText("Finished project overview")).toBeInTheDocument();
  });

  it("stops polling failed jobs and offers a setup action", async () => {
    request.mockResolvedValue({
      status: "failed",
      stage: "starting",
      progress_pct: 0,
      error: "Source unavailable",
    });
    mount();
    await settle();
    expect(screen.getByText("Source unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review setup" }),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("recovers live updates without losing the last reported progress", async () => {
    request
      .mockResolvedValueOnce({
        status: "running",
        stage: "postgres",
        progress_pct: 20,
      })
      .mockRejectedValueOnce(new Error("Network interrupted"))
      .mockResolvedValue({
        status: "running",
        stage: "mongo",
        progress_pct: 60,
      });
    mount();
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
    expect(
      screen.getByRole("heading", { name: "Reconnecting to your build." }),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
    expect(screen.queryByText("Network interrupted")).not.toBeInTheDocument();
  });

  it("does not schedule polling after an outstanding request resolves on an unmounted page", async () => {
    let resolve;
    request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = mount();
    view.unmount();
    await act(async () => {
      resolve({ status: "running", stage: "starting", progress_pct: 0 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClaudeContext from "./ClaudeContext";

const { request, clipboard, toast } = vi.hoisted(() => ({ request: vi.fn(), clipboard: vi.fn(), toast: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ request }) }));
vi.mock("../components/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("../components/PageHeader", () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock("../lib/format", () => ({ copyToClipboard: clipboard }));
const result = {
  base: { base_id: "base1234", kind: "base", contracts: [{ path: "response.ts", content: "export const sendSuccess = 1;" }] },
  task: { base_id: "base1234", kind: "task", request: { task: "Add interviews" }, models: [] },
  handoff: { kind: "handoff", request: { task: "Add interviews" }, code: [{ path: "interview.ts", content: "export function scheduleInterview() {}" }], status: "review", context_gaps: [] },
  report: { base_size: 1200, task_size: 500, handoff_size: 900, privacy: "Database records excluded.", missing: [], omitted: [], included: [], selection: "Names and imports" },
};
beforeEach(() => { vi.clearAllMocks(); request.mockReset(); sessionStorage.clear(); request.mockResolvedValue(result); clipboard.mockResolvedValue(true); });
function open() { render(<MemoryRouter initialEntries={["/contexts/example/claude-context"]}><Routes><Route path="/contexts/:contextId/claude-context" element={<ClaudeContext />} /><Route path="/ingest/:jobId/progress" element={<div>Build queued</div>} /></Routes></MemoryRouter>); }

describe("AI context pack workflow", () => {
  it('opens the full self-contained handoff even when the task-only tab is selected', async () => {
    const tab = { closed: false, document: { body: { style: {} } }, location: { replace: vi.fn() }, close: vi.fn() };
    const popup = vi.spyOn(window, 'open').mockReturnValue(tab);
    try {
      open();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open in Claude Code (paid)' })).toBeEnabled());
      fireEvent.click(screen.getByRole('tab', { name: 'Task only' }));
      request.mockResolvedValueOnce({ id: 'launch', url: 'https://claude.ai/code?prompt_url=https%3A%2F%2Fapi.example.com%2Fprompt', expires_at: '2026-10-30T12:00:00Z' });
      fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code (paid)' }));
      await waitFor(() => expect(tab.location.replace).toHaveBeenCalled());
      expect(request).toHaveBeenLastCalledWith('/api/ingestion/example/claude-launch/', { method: 'POST', body: { handoff: result.handoff } });
    } finally { popup.mockRestore(); }
  });

  it('reserves a tab during Prepare and opens Claude automatically after preparation', async () => {
    const tab = { closed: false, document: { body: { style: {} } }, location: { replace: vi.fn() }, close: vi.fn() };
    const popup = vi.spyOn(window, 'open').mockReturnValue(tab);
    let resolve;
    try {
      open();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open in Claude Code (paid)' })).toBeEnabled());
      fireEvent.click(screen.getByRole('checkbox', { name: 'Open Claude automatically after I prepare a task' }));
      fireEvent.change(screen.getByLabelText('What do you want to build?'), { target: { value: 'Add interviews' } });
      request.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ id: 'launch', url: 'https://claude.ai/code?prompt_url=https%3A%2F%2Fapi.example.com%2Fprompt', expires_at: '2026-10-30T12:00:00Z' });
      fireEvent.click(screen.getByRole('button', { name: 'Prepare context packs' }));
      expect(popup).toHaveBeenCalledOnce();
      expect(tab.location.replace).not.toHaveBeenCalled();
      await act(async () => resolve(result));
      await waitFor(() => expect(tab.location.replace).toHaveBeenCalled());
      expect(request.mock.calls.some(([path]) => path.endsWith('/claude-launch/'))).toBe(false);
      expect(clipboard).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify(result.handoff)));
      expect(tab.location.replace.mock.calls[0][0]).toMatch(/^https:\/\/claude.ai\/new/);
    } finally { popup.mockRestore(); }
  });

  it('prepares an asynchronous follow-up with the original task and acceptance criteria', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('What do you want to build?'), { target: { value: 'Add interviews' } });
    fireEvent.change(screen.getByLabelText('How will you know it works?'), { target: { value: 'Reject overlapping appointments' } });
    fireEvent.change(screen.getByLabelText('AI request or validation error'), { target: { value: 'Please show scheduleInterview' } });
    request.mockResolvedValueOnce({ preparation_id: 'prepared' }).mockResolvedValueOnce({ status: 'succeeded', output: result });
    vi.useFakeTimers();
    try {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prepare follow-up context' })); });
      expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeDisabled();
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    } finally { vi.useRealTimers(); }
    expect(request).toHaveBeenCalledWith('/api/ingestion/example/prepare/prepared/');
    expect(request.mock.calls[1][1].body).toMatchObject({ task: 'Add interviews', acceptance: 'Reject overlapping appointments', follow_up: 'Please show scheduleInterview', retrieval_mode: 'fast' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeEnabled());
  }, 10000);

  it('resumes a prepared task after reloading without storing source in browser storage', async () => {
    sessionStorage.setItem('contexa-preparation:example', 'remembered');
    request.mockResolvedValueOnce({ status: 'succeeded', output: result, request: { task: 'Add interviews', acceptance: 'No overlaps', max_tokens: 8000 } });
    open();
    await waitFor(() => expect(screen.getByLabelText('What do you want to build?')).toHaveValue('Add interviews'));
    expect(screen.getByLabelText('How will you know it works?')).toHaveValue('No overlaps');
    expect(request.mock.calls[0][0]).toBe('/api/ingestion/example/prepare/remembered/');
    expect(sessionStorage.getItem('contexa-preparation:example')).toBe('remembered');
  });

  it('carries the original task into a refreshed snapshot and prepares against the new source', async () => {
    request.mockResolvedValueOnce({ request: { task: 'Add interviews', acceptance: 'No overlaps', follow_up: 'Please show scheduleInterview', max_tokens: 8000 } }).mockResolvedValueOnce(result);
    render(<MemoryRouter initialEntries={[{ pathname: '/contexts/example/claude-context', state: { carryTask: { contextId: 'previous', preparationId: 'old-job' } } }]}><Routes><Route path='/contexts/:contextId/claude-context' element={<ClaudeContext />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeEnabled());
    expect(request.mock.calls[0][0]).toBe('/api/ingestion/previous/prepare/old-job/');
    expect(request.mock.calls[1][0]).toBe('/api/ingestion/example/prepare/');
    expect(request.mock.calls[1][1].body).toMatchObject({ task: 'Add interviews', acceptance: 'No overlaps', max_tokens: 8000, follow_up: 'Please show scheduleInterview' });
    expect(screen.getByLabelText('What do you want to build?')).toHaveValue('Add interviews');
  });
  it("copies one compact base pack and blocks stale copies after requirements change", async () => {
    open();
    await screen.findByRole("tab", { name: "Reusable base" });
    fireEvent.click(screen.getByRole("tab", { name: "Reusable base" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalled());
    expect(JSON.parse(clipboard.mock.calls[0][0])).toEqual(result.base);
    expect(clipboard.mock.calls[0][0]).not.toContain("\n");
    fireEvent.change(screen.getByLabelText("What do you want to build?"), { target: { value: "Add interviews" } });
    expect(screen.getByRole("button", { name: "Copy JSON" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Who can use it?"), { target: { value: "Recruiters" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare context packs" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][1].body).toMatchObject({ task: "Add interviews", access: "Recruiters", max_tokens: 10000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(2));
    expect(JSON.parse(clipboard.mock.calls[1][0])).toEqual(result.handoff);
  });

  it("copies a self-contained handoff and sends exact follow-up symbols", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled());
    expect(screen.getByRole("tab", { name: "AI handoff" })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByLabelText("Additional symbols (optional)"), { target: { value: "validateInterview\nsrc/types/session.ts#SessionUser" } });
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Prepare context packs" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][1].body.include_symbols).toEqual(["validateInterview", "src/types/session.ts#SessionUser"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalled());
    expect(JSON.parse(clipboard.mock.calls[0][0])).toEqual(result.handoff);
  });

  it("shows missing contracts and the specific source outside the copy budget", async () => {
    request.mockResolvedValueOnce({ ...result, handoff: { ...result.handoff, status: "incomplete" }, report: { ...result.report,
      handoff_omitted: [{ path: "src/auth.ts", symbols: ["requireRecruiter"] }],
      dependency_gaps: [{ path: "interview.ts", module: "./missing-types", reason: "local import not captured" }],
    } });
    open();
    await screen.findByText(/This handoff has missing contracts/);
    expect(screen.getByText("src/auth.ts: requireRecruiter")).toBeInTheDocument();
    expect(screen.getByText(/interview.ts → .\/missing-types/)).toBeInTheDocument();
  });

  it("does not allow copying an old pack after generation fails", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled());
    request.mockRejectedValueOnce(new Error("Source unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Prepare context packs" }));
    await screen.findByText("Source unavailable");
    expect(screen.getByRole("button", { name: "Copy JSON" })).toBeDisabled();
    expect(screen.getByText('Preparation failed')).toBeInTheDocument();
    expect(screen.queryByText('Preparing…')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare context packs' })).toBeEnabled();
  });

  it("retries with the suggested single-copy budget and preserves the task", async () => {
    request.mockResolvedValueOnce({ ...result, handoff: { ...result.handoff, status: "incomplete" },
      report: { ...result.report, suggested_handoff_budget: 16000 } }).mockResolvedValueOnce(result);
    open();
    await screen.findByRole("button", { name: "Try 16,000 token budget" });
    fireEvent.change(screen.getByLabelText("What do you want to build?"), { target: { value: "Add interviews" } });
    fireEvent.click(screen.getByRole("button", { name: "Try 16,000 token budget" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][1].body).toMatchObject({ task: "Add interviews", max_tokens: 16000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled());
  });

  it("prioritizes pinned missing files when rebuilding connected sources", async () => {
    request.mockResolvedValueOnce({ ...result, handoff: { ...result.handoff, context_gaps: ["Requested file unavailable: src/utils/helper.ts"] },
      report: { ...result.report, missing: ["Requested file unavailable: src/utils/helper.ts"] } }).mockResolvedValueOnce({ job_id: "new-build" });
    open();
    await screen.findByRole("button", { name: "Rebuild from connected sources" });
    fireEvent.change(screen.getByLabelText("Files to include (optional)"), { target: { value: "src/utils/helper.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Rebuild from connected sources" }));
    await screen.findByText("Build queued");
    expect(request.mock.calls[1]).toEqual(["/api/ingestion/example/rebuild/", { method: "POST", body: { include_paths: ["src/utils/helper.ts"] } }]);
  });
});

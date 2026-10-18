import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  report: { base_size: 1200, task_size: 500, privacy: "Database records excluded.", missing: [], omitted: [], included: [], selection: "Names and imports" },
};
beforeEach(() => { vi.clearAllMocks(); request.mockResolvedValue(result); clipboard.mockResolvedValue(true); });
function open() { render(<MemoryRouter initialEntries={["/contexts/example/claude-context"]}><Routes><Route path="/contexts/:contextId/claude-context" element={<ClaudeContext />} /></Routes></MemoryRouter>); }

describe("AI context pack workflow", () => {
  it("copies one compact base pack and blocks stale copies after requirements change", async () => {
    open();
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
    expect(request.mock.calls[1][1].body).toMatchObject({ task: "Add interviews", access: "Recruiters", max_tokens: 4000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(2));
    expect(JSON.parse(clipboard.mock.calls[1][0])).toEqual(result.task);
  });

  it("does not allow copying an old pack after generation fails", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled());
    request.mockRejectedValueOnce(new Error("Source unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Prepare context packs" }));
    await screen.findByText("Source unavailable");
    expect(screen.getByRole("button", { name: "Copy JSON" })).toBeDisabled();
  });
});

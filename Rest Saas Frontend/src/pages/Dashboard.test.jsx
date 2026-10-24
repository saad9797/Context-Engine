import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ request, user: { username: "test" } }) }));
const row = (id, name) => ({ id, project_name: name, created_at: "2026-10-24T00:00:00Z", summary: {}, sources: {} });
beforeEach(() => request.mockReset());

test("loads a bounded first page and appends more snapshots", async () => {
  request.mockResolvedValueOnce({ results: [row("1", "First project")], count: 2, next: "page2" })
    .mockResolvedValueOnce({ results: [row("2", "Second project")], count: 2, next: null });
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  await screen.findByText("First project");
  expect(request).toHaveBeenCalledWith("/api/ingestion/", { params: { page_size: 12, page: 1, q: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Load more snapshots" }));
  await screen.findByText("Second project");
  expect(screen.getByText("First project")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more snapshots" })).not.toBeInTheDocument();
});

test("debounces server search and replaces previous results", async () => {
  request.mockResolvedValueOnce({ results: [row("1", "First project")], count: 1, next: null })
    .mockResolvedValue({ results: [row("2", "Remote match")], count: 1, next: null });
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  await screen.findByText("First project");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Remote" } });
  expect(request).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(request).toHaveBeenLastCalledWith("/api/ingestion/", { params: { page_size: 12, page: 1, q: "Remote" } }));
  await screen.findByText("Remote match");
  expect(screen.queryByText("First project")).not.toBeInTheDocument();
});

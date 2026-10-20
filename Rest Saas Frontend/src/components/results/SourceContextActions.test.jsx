import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SourceContextActions from "./SourceContextActions";
import { copyToClipboard, downloadJSON } from "../../lib/format";
vi.mock("../../lib/format", () => ({ copyToClipboard: vi.fn(), downloadJSON: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each([
  ["database", "PostgreSQL"], ["database", "MySQL"],
  ["mongo_database", "MongoDB"], ["object_storage", "Storage"], ["codebase", "Codebase"],
])("copies and downloads only the selected %s source (%s)", async (sourceKey, label) => {
  const source = { schema: { enums: ["PENDING", "DONE"] }, source_files: ["complete source"] };
  copyToClipboard.mockResolvedValue(true);
  render(<SourceContextActions sourceKey={sourceKey} source={source} label={label} contextId="snapshot-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy context JSON" }));
  await screen.findByText(`${label} context JSON copied.`);
  expect(JSON.parse(copyToClipboard.mock.calls[0][0])).toEqual({ [sourceKey]: source });
  fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
  expect(downloadJSON).toHaveBeenCalledWith({ [sourceKey]: source }, `context-snapshot-1-${sourceKey}.json`);
});

it("offers download when clipboard permission is denied and allows retry", async () => {
  copyToClipboard.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<SourceContextActions sourceKey="database" source={{ tables: [] }} label="MySQL" contextId="1" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy context JSON" }));
  await screen.findByText(/Clipboard access is unavailable/);
  fireEvent.click(screen.getByRole("button", { name: "Copy context JSON" }));
  await waitFor(() => expect(screen.getByText("MySQL context JSON copied.")).toBeInTheDocument());
});

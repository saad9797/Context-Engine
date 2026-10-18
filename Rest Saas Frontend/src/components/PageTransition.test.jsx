import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import { describe, it, expect } from "vitest";
import PageTransition from "./PageTransition";

function Example() {
  const [value, setValue] = useState("");
  return <><input aria-label="Draft" value={value} onChange={(e) => setValue(e.target.value)} /><Link to="?filter=recent">Filter</Link><Link to="/second">Next page</Link></>;
}

describe("PageTransition", () => {
  it("preserves form state for query changes and renders the next route immediately", () => {
    render(<MemoryRouter initialEntries={["/first"]}><Routes>
      <Route element={<PageTransition workspace />}>
        <Route path="/first" element={<Example />} />
        <Route path="/second" element={<h1>Second page</h1>} />
      </Route>
    </Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Keep my draft" } });
    const firstContainer = screen.getByLabelText("Draft").closest(".page-transition");
    fireEvent.click(screen.getByText("Filter"));
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep my draft");
    expect(screen.getByLabelText("Draft").closest(".page-transition")).toBe(firstContainer);
    fireEvent.click(screen.getByText("Next page"));
    expect(screen.getByRole("heading", { name: "Second page" })).toBeInTheDocument();
    expect(screen.getByRole("heading").closest(".page-transition")).not.toBe(firstContainer);
  });
});

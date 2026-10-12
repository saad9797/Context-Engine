import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import Button from "@mui/material/Button";
import EmptyState from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(<EmptyState icon={ScienceOutlinedIcon} title="Nothing here" description="Try adding something." />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Try adding something.")).toBeInTheDocument();
  });

  it("renders without a description (optional)", () => {
    render(<EmptyState icon={ScienceOutlinedIcon} title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders the action when provided", () => {
    render(<EmptyState title="Nothing here" action={<Button>Do something</Button>} />);
    expect(screen.getByRole("button", { name: "Do something" })).toBeInTheDocument();
  });

  it("renders without an action (optional)", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

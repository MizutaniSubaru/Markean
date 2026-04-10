import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/components/layout/AppShell";

describe("AppShell", () => {
  it("renders the three-pane desktop layout", () => {
    render(<AppShell />);
    expect(screen.getByText("Folders")).toBeTruthy();
  });
});

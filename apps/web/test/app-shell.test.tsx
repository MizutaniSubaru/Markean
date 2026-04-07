// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/components/layout/AppShell";

describe("AppShell", () => {
  it("shows three panes and toggles preview mode", () => {
    render(<AppShell />);

    expect(screen.getByRole("region", { name: "Folders" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Editor" })).toBeTruthy();

    const previewButton = screen.getByRole("button", { name: "Preview" });
    expect(previewButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(previewButton);

    expect(previewButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Previewing note")).toBeTruthy();
  });
});

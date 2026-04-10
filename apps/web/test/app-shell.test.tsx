import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/components/layout/AppShell";

describe("AppShell Grid", () => {
  it("renders the root container with three-pane-layout class", () => {
    const { container } = render(<AppShell />);
    expect(container.firstChild).toHaveClass("three-pane-layout");
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/layout/AppShell";

function createStorageMock() {
  const data = new Map<string, string>();

  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
  };
}

describe("AppShell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createStorageMock(),
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows desktop notes chrome and toggles markdown preview", () => {
    render(<AppShell />);

    expect(screen.getByRole("region", { name: "Folders" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Editor" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search notes" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Note title" })).toBeTruthy();

    const markdownButton = screen.getByRole("button", { name: "Markdown" });
    expect(markdownButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(markdownButton);

    expect(markdownButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Previewing Markdown")).toBeTruthy();
  });

  it("creates folders and notes, then edits title and body inline", () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValueOnce("Projects");

    render(<AppShell />);

    const foldersRegion = screen.getByRole("region", { name: "Folders" });
    const notesRegion = screen.getByRole("region", { name: "Notes" });

    fireEvent.click(within(foldersRegion).getByRole("button", { name: "New folder" }));
    expect(within(foldersRegion).getByRole("button", { name: /^Projects/ })).toBeTruthy();
    expect(promptSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(within(notesRegion).getByRole("button", { name: "New note" }));
    expect(promptSpy).toHaveBeenCalledTimes(1);

    const title = screen.getByRole("textbox", { name: "Note title" });
    const body = screen.getByRole("textbox", { name: "Note body" });
    fireEvent.change(title, { target: { value: "Fresh note" } });
    fireEvent.change(body, { target: { value: "A working draft" } });

    expect((title as HTMLInputElement).value).toBe("Fresh note");
    expect((body as HTMLTextAreaElement).value).toBe("A working draft");

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(within(notesRegion).getByText("Fresh note")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Editor" })).getByText("A working draft")).toBeTruthy();
  });

  it("collapses and restores the folders pane", () => {
    render(<AppShell />);

    fireEvent.click(within(screen.getByRole("region", { name: "Folders" })).getByRole("button", { name: "Hide folders" }));
    expect(screen.queryByRole("region", { name: "Folders" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show folders" }));
    expect(screen.getByRole("region", { name: "Folders" })).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/components/desktop/Sidebar";
import { I18nProvider, createI18n } from "../src/i18n";

type Folder = {
  id: string;
  name: string;
  count: number;
};

function renderSidebar(props?: Partial<React.ComponentProps<typeof Sidebar>>) {
  const defaultProps: React.ComponentProps<typeof Sidebar> = {
    folders: [
      { id: "all", name: "All Notes", count: 7 },
      { id: "work", name: "Work", count: 3 },
    ] satisfies Folder[],
    activeFolderId: "all",
    searchQuery: "",
    onSearchChange: vi.fn(),
    onSelectFolder: vi.fn(),
    onCreateFolder: vi.fn(),
  };

  const finalProps = { ...defaultProps, ...props };
  render(
    createElement(
      I18nProvider,
      { value: createI18n("en") },
      createElement(Sidebar, finalProps),
    ),
  );
  return finalProps;
}

describe("Sidebar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders folder list with counts", () => {
    renderSidebar();

    const allNotesButton = screen.getByRole("button", { name: /all notes/i });
    const workButton = screen.getByRole("button", { name: /work/i });

    expect(allNotesButton).toBeInstanceOf(HTMLButtonElement);
    expect(workButton).toBeInstanceOf(HTMLButtonElement);
    expect(allNotesButton.textContent).toContain("7");
    expect(workButton.textContent).toContain("3");
    expect(allNotesButton.getAttribute("aria-pressed")).toBe("true");
    expect(workButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onSelectFolder when a folder is clicked", () => {
    const onSelectFolder = vi.fn();
    renderSidebar({ onSelectFolder });

    fireEvent.click(screen.getByRole("button", { name: /work/i }));

    expect(onSelectFolder).toHaveBeenCalledWith("work");
  });

  it("calls onSearchChange when typing in search", () => {
    const onSearchChange = vi.fn();
    renderSidebar({ onSearchChange });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "foo" },
    });

    expect(onSearchChange).toHaveBeenCalledWith("foo");
  });

  it("calls onCreateFolder when the new-folder button is clicked", () => {
    const onCreateFolder = vi.fn();
    renderSidebar({ onCreateFolder });

    fireEvent.click(screen.getByRole("button", { name: "New Folder" }));

    expect(onCreateFolder).toHaveBeenCalledTimes(1);
  });
});

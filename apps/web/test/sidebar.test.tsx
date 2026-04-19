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

    expect(screen.getByText("All Notes")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("calls onSelectFolder when a folder is clicked", () => {
    const onSelectFolder = vi.fn();
    renderSidebar({ onSelectFolder });

    fireEvent.click(screen.getByText("Work"));

    expect(onSelectFolder).toHaveBeenCalledWith("work");
  });

  it("calls onSearchChange when typing in search", () => {
    const onSearchChange = vi.fn();
    renderSidebar({ onSearchChange });

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "foo" },
    });

    expect(onSearchChange).toHaveBeenCalledWith("foo");
  });
});

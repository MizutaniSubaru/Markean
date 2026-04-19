import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileEditor } from "../src/components/mobile/MobileEditor";
import { MobileFolders } from "../src/components/mobile/MobileFolders";
import { MobileNoteList } from "../src/components/mobile/MobileNoteList";
import type { WorkspaceNote } from "../src/lib/storage";
import { I18nProvider, createI18n } from "../src/i18n";

const i18n = createI18n("en");

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider value={i18n}>{ui}</I18nProvider>);
}

describe("mobile components", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the folders landing view with a flat folders interface and localized create action", () => {
    const onSelectFolder = vi.fn();
    const onSearchChange = vi.fn();
    const onCreateNote = vi.fn();

    renderWithI18n(
      <MobileFolders
        folders={[
          { id: "inbox", name: "Inbox", count: 4 },
          { id: "ideas", name: "Ideas", count: 2 },
        ]}
        searchQuery="wel"
        onSearchChange={onSearchChange}
        onSelectFolder={onSelectFolder}
        onCreateNote={onCreateNote}
      />,
    );

    expect(screen.getAllByText("Folders")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /inbox/i })).toHaveTextContent("4");
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("wel");
    expect(screen.getByRole("button", { name: "New Note" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "idea" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ideas/i }));
    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    expect(onSearchChange).toHaveBeenCalledWith("idea");
    expect(onSelectFolder).toHaveBeenCalledWith("ideas");
    expect(onCreateNote).toHaveBeenCalledTimes(1);
  });

  it("renders the folder notes view without requiring active note state and uses localized create action", () => {
    const onBack = vi.fn();
    const onSelectNote = vi.fn();
    const onSearchChange = vi.fn();
    const onCreateNote = vi.fn();

    renderWithI18n(
      <MobileNoteList
        folderName="Inbox"
        noteCount={2}
        sections={[
          {
            label: "Last 7 Days",
            items: [
              {
                id: "n1",
                title: "Welcome to Markean",
                preview: "This is the first note",
                date: "10:30 AM",
              },
              {
                id: "n2",
                title: "Daily Log",
                preview: "A short update",
                date: "9:15 AM",
              },
            ],
          },
        ]}
        searchQuery=""
        onBack={onBack}
        onSearchChange={onSearchChange}
        onSelectNote={onSelectNote}
        onCreateNote={onCreateNote}
      />,
    );

    expect(screen.getAllByText("Inbox")).toHaveLength(2);
    expect(screen.getByText("2 notes")).toBeInTheDocument();
    expect(screen.getByText("Last 7 Days")).toBeInTheDocument();
    expect(screen.getByText("This is the first note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Note" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /daily log/i }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "welcome" },
    });
    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSelectNote).toHaveBeenCalledWith("n2");
    expect(onSearchChange).toHaveBeenCalledWith("welcome");
    expect(onCreateNote).toHaveBeenCalledTimes(1);
  });

  it("renders the mobile editor without requiring a done callback", () => {
    const onBack = vi.fn();
    const onChangeBody = vi.fn();
    const note: WorkspaceNote = {
      id: "n1",
      folderId: "inbox",
      title: "Welcome to Markean",
      body: "Initial body",
      updatedAt: "2026-04-20T10:30:00.000Z",
    };

    const { container } = renderWithI18n(
      <MobileEditor
        folderName="Inbox"
        note={note}
        onBack={onBack}
        onChangeBody={onChangeBody}
      />,
    );

    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(container.querySelector(".editor-content")).not.toBeNull();
    expect(container.textContent).toContain("Initial body");

    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

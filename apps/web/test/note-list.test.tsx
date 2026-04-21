import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteList } from "../src/features/notes/components/desktop/NoteList";
import { I18nProvider, createI18n } from "../src/i18n";

const i18n = createI18n("en");

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider value={i18n}>{ui}</I18nProvider>);
}

const sections = [
  {
    label: "Last 7 Days",
    items: [
      {
        id: "n1",
        title: "Test Note",
        preview: "This is a preview",
        date: "10:30 AM",
        folderName: "Inbox",
      },
      {
        id: "n2",
        title: "Another Note",
        preview: "Another preview",
        date: "9:00 AM",
        folderName: "Work",
      },
    ],
  },
];

describe("NoteList", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders note cards with titles and previews", () => {
    renderWithI18n(
      <NoteList
        folderName="Inbox"
        noteCount={2}
        sections={sections}
        activeNoteId="n1"
        searchQuery=""
        newNoteId={null}
        onSelectNote={() => {}}
        onCreateNote={() => {}}
      />,
    );

    expect(screen.getByText("Test Note")).toBeInTheDocument();
    expect(screen.getByText("This is a preview")).toBeInTheDocument();
    expect(screen.getByText("Another Note")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new note/i }),
    ).toHaveAttribute("aria-label", "New Note");
    expect(screen.getByRole("button", { name: /more actions/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /test note/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /another note/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onSelectNote when a card is clicked", () => {
    const onSelect = vi.fn();
    renderWithI18n(
      <NoteList
        folderName="Inbox"
        noteCount={2}
        sections={sections}
        activeNoteId="n1"
        searchQuery=""
        newNoteId={null}
        onSelectNote={onSelect}
        onCreateNote={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /another note/i }));

    expect(onSelect).toHaveBeenCalledWith("n2");
  });

  it("highlights search query in previews", () => {
    const searchSections = [
      {
        label: "Last 7 Days",
        items: [
          {
            id: "n1",
            title: "Test Note",
            preview: "contains async keyword here",
            date: "10:30 AM",
            folderName: "Inbox",
          },
        ],
      },
    ];

    renderWithI18n(
      <NoteList
        folderName="Search results"
        noteCount={1}
        sections={searchSections}
        activeNoteId=""
        searchQuery="async"
        newNoteId={null}
        onSelectNote={() => {}}
        onCreateNote={() => {}}
      />,
    );

    expect(screen.getByText("async", { selector: "mark" })).toBeInTheDocument();
  });
});

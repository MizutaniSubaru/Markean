import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { NotesPane } from "../src/components/layout/NotesPane";

describe("NotesPane", () => {
  it("renders notes list header and sample item", () => {
    render(<NotesPane title="All Notes" subtitle="1 notes" sections={[{label: "Today", items: [{id: "1", title: "Sample Note", timeLabel: "10:45 AM", summary: "This is a sample note snippet...", folderName: "Work"}]}]} activeNoteId="1" onSelectNote={() => {}} onCreateNote={() => {}} />);
    const header = screen.getByText("All Notes").closest(".list-header");
    expect(header).toBeInTheDocument();
    expect(screen.getByText("Sample Note")).toBeInTheDocument();
  });
});

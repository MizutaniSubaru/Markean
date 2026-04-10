import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { FoldersPane } from "../src/components/layout/FoldersPane";

describe("FoldersPane", () => {
  it("renders Folders header and list items", () => {
    // Note: Supply dummy props to FoldersPane so it renders correctly
    render(<FoldersPane folders={[{id: "all", name: "All Notes", count: 0}]} activeFolderId="all" onSelectFolder={() => {}} onCreateFolder={() => {}} />);
    expect(screen.getByText("Folders")).toBeInTheDocument();
    expect(screen.getByText("All Notes")).toBeInTheDocument();
  });
});

import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { EditorPane } from "../src/components/layout/EditorPane";

describe("EditorPane", () => {
  it("renders the toolbar and editor container", () => {
    // Note: Supply dummy props so EditorPane renders correctly
    const { container } = render(<EditorPane note={{id: "1", title: "Note", body: "Hello", folderId: "1", updatedAt: "2026-04-11T12:00:00Z", isUnsaved: false, createdAt: "2026-04-11T12:00:00Z"}} previewMode={false} onCreateNote={() => {}} onChangeBody={() => {}} onChangeTitle={() => {}} onTogglePreview={() => {}} />);
    expect(container.querySelector('.editor-toolbar')).toBeInTheDocument();
  });
});

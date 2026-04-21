import { cleanup, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { MarkeanEditor } from "../src/features/notes/components/editor/MarkeanEditor";

describe("MarkeanEditor", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hides markdown heading syntax on non-active lines", async () => {
    const { container } = render(
      <MarkeanEditor content={"Plain intro\n# Welcome to Markean"} onChange={() => {}} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-editor")).toBeInTheDocument();
    });

    await waitFor(() => {
      const headingLine = container.querySelector(".cm-md-h1");
      expect(headingLine).toBeInTheDocument();
      expect(headingLine?.textContent).toContain("Welcome to Markean");
      expect(headingLine?.textContent).not.toContain("#");
      expect(container.querySelector(".cm-md-hidden")).toBeInTheDocument();
    });
  });

  it("preserves markdown syntax on the active heading line", async () => {
    const { container } = render(
      <MarkeanEditor content={"Plain intro\n# Welcome to Markean"} onChange={() => {}} />,
    );

    const editorRoot = await waitFor(() => {
      const node = container.querySelector(".cm-editor");
      expect(node).toBeInTheDocument();
      return node as HTMLElement;
    });

    const view = EditorView.findFromDOM(editorRoot);
    expect(view).toBeTruthy();

    const headingLine = view?.state.doc.line(2);
    expect(headingLine).toBeTruthy();

    view?.dispatch({
      selection: { anchor: headingLine!.from },
    });

    await waitFor(() => {
      const renderedHeading = Array.from(container.querySelectorAll(".cm-md-h1")).find((node) =>
        node.textContent?.includes("Welcome to Markean"),
      );

      expect(renderedHeading).toBeInTheDocument();
      expect(renderedHeading?.textContent).toContain("# Welcome to Markean");
    });
  });

  it("calls onChange when the editor document changes", async () => {
    const onChange = vi.fn();
    const { container } = render(<MarkeanEditor content="Initial body" onChange={onChange} />);

    const editorRoot = await waitFor(() => {
      const node = container.querySelector(".cm-editor");
      expect(node).toBeInTheDocument();
      return node as HTMLElement;
    });

    const view = EditorView.findFromDOM(editorRoot);
    expect(view).toBeTruthy();

    view?.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "Updated body",
      },
    });

    expect(onChange).toHaveBeenCalledWith("Updated body");
  });

  it("updates the editor when the content prop changes without echoing onChange", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MarkeanEditor content="# First heading" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-md-h1")?.textContent).toContain("First heading");
    });

    rerender(<MarkeanEditor content="## Second heading" onChange={onChange} />);

    await waitFor(() => {
      const headingLine = container.querySelector(".cm-md-h2");
      expect(headingLine).toBeInTheDocument();
      expect(headingLine?.textContent).toContain("Second heading");
      expect(headingLine?.textContent).not.toContain("First heading");
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../../src/features/notes/store/editor.store";

describe("editor.store", () => {
  afterEach(() => {
    useEditorStore.setState({
      activeFolderId: "",
      activeNoteId: "",
      searchQuery: "",
      mobileView: "folders",
      newNoteId: null,
    });
  });

  it("selects a folder", () => {
    useEditorStore.setState({ searchQuery: "hello" });

    useEditorStore.getState().selectFolder("folder_1");

    expect(useEditorStore.getState().activeFolderId).toBe("folder_1");
    expect(useEditorStore.getState().searchQuery).toBe("");
  });

  it("selects a note", () => {
    useEditorStore.getState().selectNote("note_1");
    expect(useEditorStore.getState().activeNoteId).toBe("note_1");
  });

  it("sets search query", () => {
    useEditorStore.getState().setSearchQuery("hello");
    expect(useEditorStore.getState().searchQuery).toBe("hello");
  });

  it("sets mobile view", () => {
    useEditorStore.getState().setMobileView("editor");
    expect(useEditorStore.getState().mobileView).toBe("editor");
  });

  it("sets new note id", () => {
    useEditorStore.getState().setNewNoteId("note_new");
    expect(useEditorStore.getState().newNoteId).toBe("note_new");
  });
});

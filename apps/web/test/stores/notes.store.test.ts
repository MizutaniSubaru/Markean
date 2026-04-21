import { afterEach, describe, expect, it } from "vitest";
import type { NoteRecord } from "@markean/domain";
import { useNotesStore } from "../../src/features/notes/store/notes.store";

const note1: NoteRecord = {
  id: "note_1",
  folderId: "folder_1",
  title: "Test",
  bodyMd: "# Test",
  bodyPlain: "Test",
  currentRevision: 1,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

describe("notes.store", () => {
  afterEach(() => {
    useNotesStore.setState({ notes: [] });
  });

  it("starts with empty notes", () => {
    expect(useNotesStore.getState().notes).toEqual([]);
  });

  it("loads notes from hydration", () => {
    useNotesStore.getState().loadNotes([note1]);
    expect(useNotesStore.getState().notes).toEqual([note1]);
  });

  it("adds a note optimistically", () => {
    useNotesStore.getState().addNote("folder_1");
    const notes = useNotesStore.getState().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].folderId).toBe("folder_1");
    expect(notes[0].id).toMatch(/^note_/);
    expect(notes[0].bodyMd).toBe("");
    expect(notes[0].currentRevision).toBe(0);
  });

  it("updates a note optimistically", () => {
    useNotesStore.getState().loadNotes([note1]);
    useNotesStore.getState().updateNote("note_1", { bodyMd: "# Updated", title: "Updated" });
    const note = useNotesStore.getState().notes[0];
    expect(note.bodyMd).toBe("# Updated");
    expect(note.title).toBe("Updated");
    expect(note.updatedAt).not.toBe(note1.updatedAt);
  });

  it("recomputes bodyPlain when bodyMd changes", () => {
    useNotesStore.getState().loadNotes([note1]);
    useNotesStore.getState().updateNote("note_1", { bodyMd: "# Updated content" });
    expect(useNotesStore.getState().notes[0].bodyPlain).toBe("Updated content");
  });

  it("soft-deletes a note optimistically", () => {
    useNotesStore.getState().loadNotes([note1]);
    useNotesStore.getState().deleteNote("note_1");
    expect(useNotesStore.getState().notes[0].deletedAt).not.toBeNull();
  });

  it("adds a conflict copy", () => {
    useNotesStore.getState().loadNotes([note1]);
    const copy: NoteRecord = {
      ...note1,
      id: "note_conflict_copy",
      title: "Test (conflict copy)",
    };
    useNotesStore.getState().addConflictCopy(copy);
    expect(useNotesStore.getState().notes).toHaveLength(2);
    expect(useNotesStore.getState().notes[0].id).toBe("note_conflict_copy");
  });
});

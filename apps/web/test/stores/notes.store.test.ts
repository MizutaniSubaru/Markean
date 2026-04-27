import { afterEach, describe, expect, it, vi } from "vitest";
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

const note2: NoteRecord = {
  id: "note_2",
  folderId: "folder_2",
  title: "Second",
  bodyMd: "Second",
  bodyPlain: "Second",
  currentRevision: 2,
  updatedAt: "2026-04-22T10:00:00.000Z",
  deletedAt: null,
};

describe("notes.store", () => {
  afterEach(() => {
    vi.useRealTimers();
    useNotesStore.setState({ notes: [] });
  });

  it("starts with empty notes", () => {
    expect(useNotesStore.getState().notes).toEqual([]);
  });

  it("loads notes from hydration", () => {
    useNotesStore.getState().loadNotes([note1]);
    expect(useNotesStore.getState().notes).toEqual([note1]);
  });

  it("isolates loaded notes from source array mutation", () => {
    const sourceNotes = [note1];

    useNotesStore.getState().loadNotes(sourceNotes);
    sourceNotes.push(note2);

    expect(useNotesStore.getState().notes).toEqual([note1]);
  });

  it("adds a note optimistically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    useNotesStore.getState().loadNotes([note1]);

    const note = useNotesStore.getState().addNote("folder_1");
    const notes = useNotesStore.getState().notes;

    expect(notes).toHaveLength(2);
    expect(note).toEqual(notes[0]);
    expect(notes[0].folderId).toBe("folder_1");
    expect(notes[0].id).toMatch(/^note_/);
    expect(notes[0].title).toBe("");
    expect(notes[0].bodyMd).toBe("");
    expect(notes[0].bodyPlain).toBe("");
    expect(notes[0].currentRevision).toBe(0);
    expect(notes[0].updatedAt).toBe("2026-04-27T12:34:56.789Z");
    expect(notes[0].deletedAt).toBeNull();
    expect(notes[1]).toEqual(note1);
  });

  it("updates a note optimistically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    useNotesStore.getState().loadNotes([note1, note2]);

    useNotesStore.getState().updateNote("note_1", { bodyMd: "# Updated", title: "Updated" });
    const notes = useNotesStore.getState().notes;

    expect(notes[0]).toEqual({
      ...note1,
      bodyMd: "# Updated",
      bodyPlain: "Updated",
      title: "Updated",
      updatedAt: "2026-04-27T12:34:56.789Z",
    });
    expect(notes[1]).toEqual(note2);
  });

  it("soft-deletes a note optimistically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    useNotesStore.getState().loadNotes([note1, note2]);

    useNotesStore.getState().deleteNote("note_1");
    const notes = useNotesStore.getState().notes;

    expect(notes[0]).toEqual({
      ...note1,
      deletedAt: "2026-04-27T12:34:56.789Z",
    });
    expect(notes[1]).toEqual(note2);
  });

  it("adds a conflict copy", () => {
    useNotesStore.getState().loadNotes([note1]);
    const copy: NoteRecord = {
      ...note1,
      id: "note_conflict_copy",
      title: "Test (conflict copy)",
    };
    useNotesStore.getState().addConflictCopy(copy);
    expect(useNotesStore.getState().notes).toEqual([copy, note1]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { NoteRecord } from "@markean/domain";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { useEditorStore } from "../../src/features/notes/store/editor.store";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";
import { deriveNoteList } from "../../src/features/notes/hooks/useNoteList";

const now = new Date("2026-04-21T09:00:00.000Z");

function makeNote(overrides: Partial<NoteRecord> & { id: string }): NoteRecord {
  return {
    folderId: "folder_1",
    title: overrides.id,
    bodyMd: "",
    bodyPlain: "",
    currentRevision: 1,
    updatedAt: now.toISOString(),
    deletedAt: null,
    ...overrides,
  };
}

describe("deriveNoteList", () => {
  afterEach(() => {
    useNotesStore.setState({ notes: [] });
    useEditorStore.setState({
      activeFolderId: "",
      activeNoteId: "",
      searchQuery: "",
      mobileView: "folders",
      newNoteId: null,
    });
    useFoldersStore.setState({ folders: [] });
  });

  it("filters notes by active folder", () => {
    useNotesStore.setState({
      notes: [
        makeNote({ id: "n1", folderId: "f1" }),
        makeNote({ id: "n2", folderId: "f2" }),
      ],
    });
    useEditorStore.setState({ activeFolderId: "f1", searchQuery: "" });

    const { notesInScope } = deriveNoteList("en");
    expect(notesInScope).toHaveLength(1);
    expect(notesInScope[0].id).toBe("n1");
  });

  it("filters by search query across all folders", () => {
    useFoldersStore.setState({
      folders: [
        {
          id: "f1",
          name: "Work",
          sortOrder: 0,
          currentRevision: 1,
          updatedAt: now.toISOString(),
          deletedAt: null,
        },
      ],
    });
    useNotesStore.setState({
      notes: [
        makeNote({ id: "n1", folderId: "f1", title: "Meeting notes", bodyMd: "agenda" }),
        makeNote({ id: "n2", folderId: "f1", title: "Shopping list", bodyMd: "milk" }),
      ],
    });
    useEditorStore.setState({ activeFolderId: "f1", searchQuery: "meeting" });

    const { notesInScope } = deriveNoteList("en");
    expect(notesInScope).toHaveLength(1);
    expect(notesInScope[0].id).toBe("n1");
  });

  it("excludes soft-deleted notes", () => {
    useNotesStore.setState({
      notes: [
        makeNote({ id: "n1", folderId: "f1" }),
        makeNote({ id: "n2", folderId: "f1", deletedAt: now.toISOString() }),
      ],
    });
    useEditorStore.setState({ activeFolderId: "f1", searchQuery: "" });

    const { notesInScope } = deriveNoteList("en");
    expect(notesInScope).toHaveLength(1);
  });

  it("returns grouped sections", () => {
    useNotesStore.setState({
      notes: [makeNote({ id: "n1", folderId: "f1" })],
    });
    useEditorStore.setState({ activeFolderId: "f1", searchQuery: "" });

    const { sections } = deriveNoteList("en");
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].items[0].id).toBe("n1");
  });
});

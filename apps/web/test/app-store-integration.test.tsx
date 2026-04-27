import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { FolderRecord, NoteRecord } from "@markean/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { useEditorStore } from "../src/features/notes/store/editor.store";
import { useFoldersStore } from "../src/features/notes/store/folders.store";
import { useNotesStore } from "../src/features/notes/store/notes.store";
import { useSyncStore } from "../src/features/notes/store/sync.store";

const { persistence, schedulerState } = vi.hoisted(() => ({
  persistence: {
    createFolder: vi.fn(),
    createNote: vi.fn(),
  },
  schedulerState: {
    scheduler: null as null | { requestSync: ReturnType<typeof vi.fn> },
  },
}));

vi.mock("../src/app/bootstrap", () => ({
  getScheduler: () => schedulerState.scheduler,
}));

vi.mock("../src/features/notes/persistence/folders.persistence", () => ({
  createFolder: persistence.createFolder,
}));

vi.mock("../src/features/notes/persistence/notes.persistence", () => ({
  createNote: persistence.createNote,
}));

vi.mock("../src/features/notes/components/editor/MarkeanEditor", () => ({
  MarkeanEditor: ({
    content,
    onChange,
  }: {
    content: string;
    onChange: (nextContent: string) => void;
  }) => (
    <textarea
      aria-label="Editor"
      value={content}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function folder(overrides: Partial<FolderRecord> & Pick<FolderRecord, "id" | "name">): FolderRecord {
  return {
    sortOrder: 0,
    currentRevision: 1,
    updatedAt: "2026-04-27T12:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function note(overrides: Partial<NoteRecord> & Pick<NoteRecord, "id" | "folderId">): NoteRecord {
  return {
    title: overrides.id,
    bodyMd: "",
    bodyPlain: "",
    currentRevision: 1,
    updatedAt: "2026-04-27T12:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function resetStores(): void {
  useFoldersStore.setState({ folders: [] });
  useNotesStore.setState({ notes: [] });
  useEditorStore.setState({
    activeFolderId: "",
    activeNoteId: "",
    searchQuery: "",
    mobileView: "folders",
    newNoteId: null,
  });
  useSyncStore.setState({
    status: "idle",
    isOnline: true,
    lastSyncedAt: null,
    activeRunId: null,
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("App store integration", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    resetStores();
    schedulerState.scheduler = { requestSync: vi.fn() };
    persistence.createFolder.mockResolvedValue(undefined);
    persistence.createNote.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetStores();
    schedulerState.scheduler = null;
  });

  it("rolls back an optimistic note create when persistence rejects", async () => {
    const existingNote = note({
      id: "note_existing",
      folderId: "folder_notes",
      title: "Existing note",
      bodyMd: "# Existing note",
    });
    useFoldersStore.getState().loadFolders([folder({ id: "folder_notes", name: "Notes" })]);
    useNotesStore.getState().loadNotes([existingNote]);
    useEditorStore.setState({
      activeFolderId: "folder_notes",
      activeNoteId: "note_existing",
      mobileView: "editor",
    });
    persistence.createNote.mockRejectedValueOnce(new Error("note write failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    await waitFor(() => {
      expect(persistence.createNote).toHaveBeenCalledTimes(1);
      expect(useNotesStore.getState().notes).toEqual([existingNote]);
    });

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "folder_notes",
      activeNoteId: "note_existing",
      newNoteId: null,
    });
    expect(useSyncStore.getState().status).toBe("idle");
    expect(schedulerState.scheduler?.requestSync).not.toHaveBeenCalled();
  });

  it("preserves a newer note selection when optimistic note create later rejects", async () => {
    const firstNote = note({
      id: "note_first",
      folderId: "folder_notes",
      title: "First note",
      bodyMd: "# First note",
      updatedAt: "2026-04-27T12:00:00.000Z",
    });
    const secondNote = note({
      id: "note_second",
      folderId: "folder_notes",
      title: "Second note",
      bodyMd: "# Second note",
      updatedAt: "2026-04-27T13:00:00.000Z",
    });
    const createNotePersistence = deferred<void>();
    useFoldersStore.getState().loadFolders([folder({ id: "folder_notes", name: "Notes" })]);
    useNotesStore.getState().loadNotes([secondNote, firstNote]);
    useEditorStore.setState({
      activeFolderId: "folder_notes",
      activeNoteId: "note_first",
      searchQuery: "",
      mobileView: "editor",
      newNoteId: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    persistence.createNote.mockReturnValueOnce(createNotePersistence.promise);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    const optimisticNoteId = useEditorStore.getState().activeNoteId;
    expect(optimisticNoteId).not.toBe("note_first");
    expect(optimisticNoteId).not.toBe("note_second");

    fireEvent.click(screen.getByRole("button", { name: /second note/i }));
    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "folder_notes",
      activeNoteId: "note_second",
      mobileView: "editor",
      newNoteId: optimisticNoteId,
    });

    createNotePersistence.reject(new Error("note write failed"));

    await waitFor(() => {
      expect(useNotesStore.getState().notes.map((existing) => existing.id)).toEqual([
        "note_second",
        "note_first",
      ]);
      expect(useEditorStore.getState()).toMatchObject({
        activeFolderId: "folder_notes",
        activeNoteId: "note_second",
        mobileView: "editor",
        newNoteId: null,
      });
    });
    expect(useSyncStore.getState().status).toBe("idle");
    expect(schedulerState.scheduler?.requestSync).not.toHaveBeenCalled();
  });

  it("rolls back an optimistic folder create when persistence rejects", async () => {
    const existingFolder = folder({ id: "folder_notes", name: "Notes" });
    const existingNote = note({
      id: "note_existing",
      folderId: "folder_notes",
      title: "Existing note",
      bodyMd: "# Existing note",
    });
    useFoldersStore.getState().loadFolders([existingFolder]);
    useNotesStore.getState().loadNotes([existingNote]);
    useEditorStore.setState({
      activeFolderId: "folder_notes",
      activeNoteId: "note_existing",
      mobileView: "editor",
    });
    persistence.createFolder.mockRejectedValueOnce(new Error("folder write failed"));
    vi.spyOn(window, "prompt").mockReturnValue("Drafts");
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New Folder" }));

    await waitFor(() => {
      expect(persistence.createFolder).toHaveBeenCalledTimes(1);
      expect(useFoldersStore.getState().folders).toEqual([existingFolder]);
    });

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "folder_notes",
      activeNoteId: "note_existing",
      newNoteId: null,
    });
    expect(useSyncStore.getState().status).toBe("idle");
    expect(schedulerState.scheduler?.requestSync).not.toHaveBeenCalled();
  });
});

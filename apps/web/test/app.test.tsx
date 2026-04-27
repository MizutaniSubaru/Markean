import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { FolderRecord, NoteRecord } from "@markean/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { useEditorStore } from "../src/features/notes/store/editor.store";
import { useFoldersStore } from "../src/features/notes/store/folders.store";
import { useNotesStore } from "../src/features/notes/store/notes.store";
import { useSyncStore } from "../src/features/notes/store/sync.store";

const { foldersPersistence, notesPersistence, schedulerState } = vi.hoisted(() => ({
  foldersPersistence: {
    createFolder: vi.fn(),
    getAllFolders: vi.fn(),
  },
  notesPersistence: {
    createNote: vi.fn(),
    getAllNotes: vi.fn(),
    updateNote: vi.fn(),
  },
  schedulerState: {
    scheduler: null as null | { requestSync: ReturnType<typeof vi.fn> },
  },
}));

vi.mock("../src/app/bootstrap", () => ({
  getScheduler: () => schedulerState.scheduler,
}));

vi.mock("../src/features/notes/persistence/folders.persistence", () => ({
  createFolder: foldersPersistence.createFolder,
  getAllFolders: foldersPersistence.getAllFolders,
}));

vi.mock("../src/features/notes/persistence/notes.persistence", () => ({
  createNote: notesPersistence.createNote,
  getAllNotes: notesPersistence.getAllNotes,
  updateNote: notesPersistence.updateNote,
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
  const bodyMd = overrides.bodyMd ?? "";
  return {
    title: overrides.id,
    bodyMd,
    bodyPlain: bodyMd.replace(/[#*_`>-]/g, "").replace(/\n+/g, " ").trim(),
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

function seedWorkspace(): { folder: FolderRecord; note: NoteRecord } {
  const workspaceFolder = folder({ id: "folder_notes", name: "Notes" });
  const workspaceNote = note({
    id: "note_welcome",
    folderId: workspaceFolder.id,
    title: "Welcome to Markean",
    bodyMd: "# Welcome to Markean\n\nStart here.",
    bodyPlain: "Welcome to Markean Start here.",
  });

  useFoldersStore.getState().loadFolders([workspaceFolder]);
  useNotesStore.getState().loadNotes([workspaceNote]);
  useEditorStore.setState({
    activeFolderId: workspaceFolder.id,
    activeNoteId: workspaceNote.id,
    searchQuery: "",
    mobileView: "editor",
    newNoteId: null,
  });

  return { folder: workspaceFolder, note: workspaceNote };
}

describe("App", () => {
  beforeEach(() => {
    resetStores();
    mockMatchMedia(false);
    schedulerState.scheduler = { requestSync: vi.fn() };
    foldersPersistence.createFolder.mockReset().mockResolvedValue(undefined);
    foldersPersistence.getAllFolders.mockReset().mockResolvedValue([]);
    notesPersistence.createNote.mockReset().mockResolvedValue(undefined);
    notesPersistence.getAllNotes.mockReset().mockResolvedValue([]);
    notesPersistence.updateNote.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetStores();
    schedulerState.scheduler = null;
  });

  it("renders the desktop workspace with a seeded note", () => {
    const { note: seededNote } = seedWorkspace();

    render(<App />);

    expect(screen.getByRole("heading", { name: "Folders" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByText("1 notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /welcome to markean/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Editor" })).toHaveValue(seededNote.bodyMd);
  });

  it("renders the mobile folders view from the folder store", () => {
    const notesFolder = folder({ id: "folder_notes", name: "Notes", sortOrder: 0 });
    const archiveFolder = folder({ id: "folder_archive", name: "Archive", sortOrder: 1 });
    useFoldersStore.getState().loadFolders([notesFolder, archiveFolder]);
    useNotesStore.getState().loadNotes([
      note({
        id: "note_welcome",
        folderId: notesFolder.id,
        title: "Welcome to Markean",
        bodyMd: "# Welcome to Markean",
      }),
    ]);
    useEditorStore.setState({ activeFolderId: notesFolder.id, activeNoteId: "note_welcome" });
    mockMatchMedia(true);

    render(<App />);

    expect(screen.getAllByText("Folders")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /notes/i })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /archive/i })).toHaveTextContent("0");
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Note" })).toBeInTheDocument();
  });

  it("creates a store note from New Note and marks sync unsynced", async () => {
    const { folder: seededFolder } = seedWorkspace();

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    await waitFor(() => {
      expect(notesPersistence.createNote).toHaveBeenCalledTimes(1);
      expect(useSyncStore.getState().status).toBe("unsynced");
    });

    const [createdNote] = useNotesStore.getState().notes;
    expect(createdNote).toMatchObject({
      folderId: seededFolder.id,
      title: "",
      bodyMd: "",
      bodyPlain: "",
      currentRevision: 0,
      deletedAt: null,
    });
    expect(createdNote.id).toMatch(/^note_/);
    expect(useNotesStore.getState().notes).toHaveLength(2);
    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: seededFolder.id,
      activeNoteId: createdNote.id,
      searchQuery: "",
      mobileView: "editor",
      newNoteId: createdNote.id,
    });
    expect(notesPersistence.createNote).toHaveBeenCalledWith(createdNote);
    expect(schedulerState.scheduler?.requestSync).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2 notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /untitled/i })).toBeInTheDocument();
  });

  it("updates the active note body in the store when editing", async () => {
    const { note: seededNote } = seedWorkspace();
    const nextBody = "# Updated welcome note\n\nMore detail.";

    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "Editor" }), {
      target: { value: nextBody },
    });

    await waitFor(() => {
      expect(useNotesStore.getState().notes.find((existing) => existing.id === seededNote.id))
        .toMatchObject({
          bodyMd: nextBody,
          bodyPlain: "Updated welcome note More detail.",
          title: "Updated welcome note",
        });
    });
    await waitFor(() => {
      expect(notesPersistence.updateNote).toHaveBeenCalledWith(seededNote.id, {
        bodyMd: nextBody,
        bodyPlain: "Updated welcome note More detail.",
        title: "Updated welcome note",
      });
      expect(useSyncStore.getState().status).toBe("unsynced");
    });
    expect(schedulerState.scheduler?.requestSync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /updated welcome note/i })).toBeInTheDocument();
  });
});

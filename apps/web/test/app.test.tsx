import "fake-indexeddb/auto";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FolderRecord, NoteRecord } from "@markean/domain";
import { useEditorStore } from "../src/features/notes/store/editor.store";
import { useFoldersStore } from "../src/features/notes/store/folders.store";
import { useNotesStore } from "../src/features/notes/store/notes.store";
import { useSyncStore } from "../src/features/notes/store/sync.store";

const createNoteMock = vi.fn().mockResolvedValue(undefined);
const updateNoteMock = vi.fn().mockResolvedValue(undefined);
const createFolderMock = vi.fn().mockResolvedValue(undefined);
const requestSyncMock = vi.fn();

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

vi.mock("../src/app/bootstrap", () => ({
  getScheduler: () => ({ requestSync: requestSyncMock }),
}));

vi.mock("../src/features/notes/persistence/notes.persistence", () => ({
  createNote: (...args: unknown[]) => createNoteMock(...args),
  updateNote: (...args: unknown[]) => updateNoteMock(...args),
  getAllNotes: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/features/notes/persistence/folders.persistence", () => ({
  createFolder: (...args: unknown[]) => createFolderMock(...args),
  getAllFolders: vi.fn().mockResolvedValue([]),
}));

import { App } from "../src/app/App";

type MatchMediaOptions = { matches: boolean };

function mockMatchMedia({ matches }: MatchMediaOptions) {
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

const defaultFolder: FolderRecord = {
  id: "notes",
  name: "Notes",
  sortOrder: 0,
  currentRevision: 1,
  updatedAt: "2026-04-20T09:00:00.000Z",
  deletedAt: null,
};

const welcomeNote: NoteRecord = {
  id: "welcome-note",
  folderId: "notes",
  title: "Welcome to Markean",
  bodyMd: "# Welcome to Markean\n\nHello!",
  bodyPlain: "Welcome to Markean Hello!",
  currentRevision: 1,
  updatedAt: "2026-04-20T09:00:00.000Z",
  deletedAt: null,
};

function seedStores(options?: { folders?: FolderRecord[]; notes?: NoteRecord[] }) {
  const folders = options?.folders ?? [defaultFolder];
  const notes = options?.notes ?? [welcomeNote];
  useFoldersStore.getState().loadFolders(folders);
  useNotesStore.getState().loadNotes(notes);
  const activeFolder = folders.find((folder) => !folder.deletedAt);
  if (activeFolder) {
    useEditorStore.getState().selectFolder(activeFolder.id);
    const firstNote = notes.find((note) => note.folderId === activeFolder.id && !note.deletedAt);
    if (firstNote) {
      useEditorStore.getState().selectNote(firstNote.id);
    }
  }
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    createNoteMock.mockClear();
    updateNoteMock.mockClear();
    createFolderMock.mockClear();
    requestSyncMock.mockClear();
    useNotesStore.setState({ notes: [] });
    useFoldersStore.setState({ folders: [] });
    useEditorStore.setState({
      activeFolderId: "",
      activeNoteId: "",
      searchQuery: "",
      mobileView: "folders",
      newNoteId: null,
    });
    useSyncStore.setState({ status: "idle", isOnline: true, lastSyncedAt: null });
  });

  it("renders the desktop workspace with a note", () => {
    mockMatchMedia({ matches: false });
    seedStores();

    render(<App />);

    expect(screen.getByText("Folders")).toBeInTheDocument();
    expect(screen.getByText("Welcome to Markean")).toBeInTheDocument();
  });

  it("renders the mobile folders view", () => {
    mockMatchMedia({ matches: true });
    seedStores();

    render(<App />);

    expect(screen.getAllByText("Folders")).toHaveLength(2);
  });

  it("creates a new note when clicking New Note", async () => {
    mockMatchMedia({ matches: false });
    seedStores();

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    await waitFor(() => {
      expect(useNotesStore.getState().notes).toHaveLength(2);
      expect(useSyncStore.getState().status).toBe("unsynced");
      expect(createNoteMock).toHaveBeenCalledTimes(1);
      expect(requestSyncMock).toHaveBeenCalledTimes(1);
    });
  });

  it("creates a folder when clicking the add-folder button", async () => {
    mockMatchMedia({ matches: false });
    seedStores();
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("Work"));

    render(<App />);

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(useFoldersStore.getState().folders).toHaveLength(2);
      expect(useFoldersStore.getState().folders[1].name).toBe("Work");
      expect(createFolderMock).toHaveBeenCalledTimes(1);
      expect(requestSyncMock).toHaveBeenCalledTimes(1);
    });
  });

  it("updates note body when editing", async () => {
    mockMatchMedia({ matches: false });
    seedStores();

    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: "Editor" }), {
      target: { value: "# Updated content" },
    });

    await waitFor(() => {
      const note = useNotesStore.getState().notes.find((candidate) => candidate.id === "welcome-note");
      expect(note?.bodyMd).toBe("# Updated content");
      expect(updateNoteMock).toHaveBeenCalledTimes(1);
      expect(useSyncStore.getState().status).toBe("unsynced");
    });
  });
});

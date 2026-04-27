import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let capturedBackgroundSyncRunOnce: (() => Promise<void>) | null = null;

vi.mock("../src/lib/sync", () => ({
  startBackgroundSync: vi.fn((runOnce: () => Promise<void>) => {
    capturedBackgroundSyncRunOnce = runOnce;
    return vi.fn();
  }),
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

import { App } from "../src/app/App";

type MatchMediaOptions = {
  matches: boolean;
};

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

function installStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  return storage;
}

function seedWorkspace(storage: ReturnType<typeof installStorageMock>, snapshot: unknown) {
  storage.setItem("markean:workspace", JSON.stringify(snapshot));
}

describe("App", () => {
  let storage: ReturnType<typeof installStorageMock>;

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    capturedBackgroundSyncRunOnce = null;
  });

  beforeEach(() => {
    storage = installStorageMock();
  });

  it("renders the desktop workspace with the welcome note on first load", () => {
    mockMatchMedia({ matches: false });

    render(<App />);

    expect(screen.getByText("Folders")).toBeInTheDocument();
    expect(screen.getByText("Welcome to Markean")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
  });

  it("renders the mobile folders view and can navigate into a folder", () => {
    mockMatchMedia({ matches: true });

    render(<App />);

    expect(screen.getAllByText("Folders")).toHaveLength(2);
    fireEvent.click(screen.getByText("Notes"));
    expect(screen.getByText("1 notes")).toBeInTheDocument();
    expect(screen.getByText("Welcome to Markean")).toBeInTheDocument();
  });

  it("updates the visible and persisted note title when the body heading changes", async () => {
    mockMatchMedia({ matches: false });

    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: "Editor" }), {
      target: { value: "# Updated welcome note\n\nMore detail." },
    });

    await waitFor(() => {
      expect(storage.getItem("markean:draft:welcome-note")).toBe("# Updated welcome note\n\nMore detail.");
      expect(storage.getItem("markean:sync-status")).toBe("unsynced");
    });

    const persistedWorkspace = storage.getItem("markean:workspace");
    expect(persistedWorkspace).not.toBeNull();
    expect(JSON.parse(persistedWorkspace ?? "{}")).toMatchObject({
      activeFolderId: "notes",
      activeNoteId: "welcome-note",
      notes: [
        expect.objectContaining({
          id: "welcome-note",
          body: "# Updated welcome note\n\nMore detail.",
          title: "Updated welcome note",
        }),
      ],
    });
    expect(screen.getByRole("button", { name: /updated welcome note/i })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps sync status unsynced if a user edit happens while background sync is in flight", async () => {
    mockMatchMedia({ matches: false });

    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: "Editor" }), {
      target: { value: "# First edit" },
    });

    expect(capturedBackgroundSyncRunOnce).not.toBeNull();

    const syncPromise = capturedBackgroundSyncRunOnce?.();

    fireEvent.change(screen.getByRole("textbox", { name: "Editor" }), {
      target: { value: "# Second edit while syncing" },
    });

    await syncPromise;

    await waitFor(() => {
      expect(storage.getItem("markean:sync-status")).toBe("unsynced");
    });
  });

  it("clears search and keeps a newly created note visible when creating from desktop search results", async () => {
    mockMatchMedia({ matches: false });

    render(<App />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "welcome" },
    });
    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    await waitFor(() => {
      expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    });

    expect(screen.getByText("2 notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /untitled/i })).toBeInTheDocument();

    const persistedWorkspace = JSON.parse(storage.getItem("markean:workspace") ?? "{}");
    expect(persistedWorkspace.activeFolderId).toBe("notes");
    expect(persistedWorkspace.notes[0]).toMatchObject({
      folderId: "notes",
      title: "",
      body: "",
    });
  });

  it("creates a note in the first visible folder when composing from the mobile folders landing view", async () => {
    seedWorkspace(storage, {
      folders: [
        { id: "inbox", name: "Inbox" },
        { id: "archive", name: "Archive" },
      ],
      notes: [
        {
          id: "archive-note",
          folderId: "archive",
          title: "Archived note",
          body: "# Archived note",
          updatedAt: "2026-04-20T09:00:00.000Z",
        },
      ],
      activeFolderId: "archive",
      activeNoteId: "archive-note",
    });
    mockMatchMedia({ matches: true });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
    });

    const persistedWorkspace = JSON.parse(storage.getItem("markean:workspace") ?? "{}");
    expect(persistedWorkspace.activeFolderId).toBe("inbox");
    expect(persistedWorkspace.notes[0]).toMatchObject({
      folderId: "inbox",
      title: "",
      body: "",
    });
  });
});

import { useEffect, useState } from "react";
import {
  getDraft,
  getWorkspaceSnapshot,
  saveDraft,
  saveWorkspaceSnapshot,
  setSyncStatus,
  type WorkspaceFolder,
  type WorkspaceNote,
  type WorkspaceSnapshot,
} from "../../lib/storage";
import { EditorPane } from "./EditorPane";
import { FoldersPane } from "./FoldersPane";
import { NotesPane } from "./NotesPane";

const defaultFolders: WorkspaceFolder[] = [
  { id: "inbox", name: "Inbox" },
  { id: "research", name: "Research" },
  { id: "archive", name: "Archive" },
];

const defaultNotes: WorkspaceNote[] = [
  {
    id: "note-dawn",
    folderId: "research",
    title: "Javascript",
    body: "Local Storage is the browser's built-in offline store.\n\nDrafts should feel immediate, then sync later.",
    updatedAt: "2026-04-07T19:15:00.000Z",
  },
  {
    id: "note-margin",
    folderId: "inbox",
    title: "SignalR and MessagePack",
    body: "Realtime transport is not the first thing this product needs.\n\nStability comes before transport tricks.",
    updatedAt: "2026-04-07T16:40:00.000Z",
  },
  {
    id: "note-archive",
    folderId: "archive",
    title: "IndexedDB and Dexie",
    body: "For web, IndexedDB is the local-first base.\n\nDexie gives it a friendlier surface area.",
    updatedAt: "2026-04-06T10:20:00.000Z",
  },
];

type NotesPaneItem = {
  id: string;
  title: string;
  summary: string;
  timeLabel: string;
  folderName?: string;
};

type NotesPaneSection = {
  label: string;
  items: NotesPaneItem[];
};

function createId(prefix: "folder" | "note") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatNoteTitle(note: WorkspaceNote) {
  const trimmed = note.title.trim();
  if (trimmed) {
    return trimmed;
  }

  const bodyHeadline = note.body
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);

  return bodyHeadline ?? "Untitled note";
}

function summarizeNote(body: string) {
  const summary = body
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!summary) {
    return "A blank note waiting for its first line.";
  }

  return summary.length > 96 ? `${summary.slice(0, 96).trimEnd()}...` : summary;
}

function formatTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startOfToday.getTime() - startOfTarget.getTime()) / 86_400_000);

  if (diff === 0) {
    return "Today";
  }

  if (diff === 1) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function buildDefaultWorkspace(): WorkspaceSnapshot {
  return {
    folders: defaultFolders,
    notes: defaultNotes.map((note) => ({
      ...note,
      body: getDraft(note.id, note.body),
    })),
    activeFolderId: "research",
    activeNoteId: "note-dawn",
  };
}

function normalizeWorkspace(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const folders = snapshot.folders.length > 0 ? snapshot.folders : defaultFolders;
  const notes = snapshot.notes.map((note) => ({
    ...note,
    body: getDraft(note.id, note.body),
    updatedAt:
      typeof note.updatedAt === "string" && note.updatedAt.length > 0
        ? note.updatedAt
        : new Date().toISOString(),
  }));
  const activeFolderId = folders.some((folder) => folder.id === snapshot.activeFolderId)
    ? snapshot.activeFolderId
    : folders[0]?.id ?? "";
  const activeNoteId = notes.some((note) => note.id === snapshot.activeNoteId)
    ? snapshot.activeNoteId
    : notes.find((note) => note.folderId === activeFolderId)?.id ?? notes[0]?.id ?? "";

  return {
    folders,
    notes,
    activeFolderId,
    activeNoteId,
  };
}

function loadWorkspace() {
  const persisted = getWorkspaceSnapshot();
  return normalizeWorkspace(persisted ?? buildDefaultWorkspace());
}

function sortNotes(notes: WorkspaceNote[]) {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function groupNotesByDate(notes: WorkspaceNote[], folderNameById: Map<string, string>, includeFolderName: boolean) {
  const sections = new Map<string, NotesPaneItem[]>();

  for (const note of sortNotes(notes)) {
    const label = formatDateLabel(note.updatedAt);
    const items = sections.get(label) ?? [];
    items.push({
      id: note.id,
      title: formatNoteTitle(note),
      summary: summarizeNote(note.body),
      timeLabel: formatTimeLabel(note.updatedAt),
      folderName: includeFolderName ? folderNameById.get(note.folderId) ?? "Folder" : undefined,
    });
    sections.set(label, items);
  }

  return Array.from(sections.entries()).map(([label, items]) => ({
    label,
    items,
  })) satisfies NotesPaneSection[];
}

export function AppShell() {
  const [previewMode, setPreviewMode] = useState(false);
  const [workspace, setWorkspace] = useState(loadWorkspace);

  useEffect(() => {
    saveWorkspaceSnapshot(workspace);
  }, [workspace]);

  const folderNameById = new Map(workspace.folders.map((folder) => [folder.id, folder.name]));

  const folders = workspace.folders.map((folder) => ({
    ...folder,
    count: workspace.notes.filter((note) => note.folderId === folder.id).length,
  }));

  const activeFolder = workspace.folders.find((folder) => folder.id === workspace.activeFolderId) ?? workspace.folders[0] ?? null;
  const notesInScope = workspace.notes.filter((note) => note.folderId === activeFolder?.id);
  const activeNote =
    workspace.notes.find((note) => note.id === workspace.activeNoteId) ??
    sortNotes(notesInScope)[0] ??
    null;
  const noteSections = groupNotesByDate(notesInScope, folderNameById, false);

  const handleSelectFolder = (folderId: string) => {
    setWorkspace((current) => {
      const nextNotes = sortNotes(current.notes.filter((note) => note.folderId === folderId));

      return {
        ...current,
        activeFolderId: folderId,
        activeNoteId: nextNotes[0]?.id ?? "",
      };
    });
  };

  const handleCreateFolder = () => {
    const name = window.prompt("Folder name", "New Folder")?.trim();
    if (!name) {
      return;
    }

    const folderId = createId("folder");
    setWorkspace((current) => ({
      ...current,
      folders: [{ id: folderId, name }, ...current.folders],
      activeFolderId: folderId,
      activeNoteId: "",
    }));
    setPreviewMode(false);
    setSyncStatus("unsynced");
  };

  const handleCreateNote = () => {
    const folderId = workspace.activeFolderId || workspace.folders[0]?.id;
    if (!folderId) {
      return;
    }

    const noteId = createId("note");
    const now = new Date().toISOString();
    saveDraft(noteId, "");

    setWorkspace((current) => ({
      ...current,
      activeFolderId: folderId,
      activeNoteId: noteId,
      notes: [
        {
          id: noteId,
          folderId,
          title: "",
          body: "",
          updatedAt: now,
        },
        ...current.notes,
      ],
    }));
    setPreviewMode(false);
    setSyncStatus("unsynced");
  };

  const handleSelectNote = (noteId: string) => {
    const nextNote = workspace.notes.find((note) => note.id === noteId);
    setWorkspace((current) => ({
      ...current,
      activeFolderId: nextNote?.folderId ?? current.activeFolderId,
      activeNoteId: noteId,
    }));
    setPreviewMode(false);
  };

  const updateActiveNote = (mutator: (note: WorkspaceNote) => WorkspaceNote) => {
    if (!activeNote) {
      return;
    }

    setWorkspace((current) => ({
      ...current,
      notes: current.notes.map((note) => (note.id === activeNote.id ? mutator(note) : note)),
    }));
    setSyncStatus("unsynced");
  };

  const handleChangeNoteTitle = (nextTitle: string) => {
    updateActiveNote((note) => ({
      ...note,
      title: nextTitle,
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleChangeNoteBody = (nextBody: string) => {
    if (!activeNote) {
      return;
    }

    saveDraft(activeNote.id, nextBody);
    updateActiveNote((note) => ({
      ...note,
      body: nextBody,
      updatedAt: new Date().toISOString(),
    }));
  };

  return (
    <div className="three-pane-layout">
      <aside className="pane-sidebar">
        <FoldersPane
          folders={folders}
          activeFolderId={activeFolder?.id ?? ""}
          onCreateFolder={handleCreateFolder}
          onSelectFolder={handleSelectFolder}
        />
      </aside>
      <section className="pane-notes-list">
        <NotesPane
          title={activeFolder?.name ?? "Notes"}
          subtitle={`${notesInScope.length} notes in ${activeFolder?.name ?? "this folder"}`}
          sections={noteSections}
          activeNoteId={activeNote?.id ?? ""}
          onCreateNote={handleCreateNote}
          onSelectNote={handleSelectNote}
        />
      </section>
      <main className="pane-editor">
        <EditorPane
          note={activeNote}
          previewMode={previewMode}
          onCreateNote={handleCreateNote}
          onChangeBody={handleChangeNoteBody}
          onChangeTitle={handleChangeNoteTitle}
          onTogglePreview={setPreviewMode}
        />
      </main>
    </div>
  );
}

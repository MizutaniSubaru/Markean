import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { getWelcomeNote } from "./components/shared/WelcomeNote";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { createI18n, detectLocale } from "./i18n";
import {
  getDraft,
  getSyncStatus,
  getWorkspaceSnapshot,
  saveDraft,
  saveWorkspaceSnapshot,
  setSyncStatus,
  subscribeToStorageState,
  type SyncStatus,
  type WorkspaceNote,
  type WorkspaceSnapshot,
} from "./lib/storage";
import { startBackgroundSync } from "./lib/sync";

export type MobileView = "folders" | "notes" | "editor";

type NoteItem = {
  id: string;
  title: string;
  preview: string;
  date: string;
  folderName?: string;
};

type NoteSection = {
  label: string;
  items: NoteItem[];
};

function createId(prefix: "folder" | "note") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function serializeWorkspace(snapshot: WorkspaceSnapshot) {
  return JSON.stringify(snapshot);
}

function createDefaultWorkspace(locale: string): WorkspaceSnapshot {
  const welcomeNote = getWelcomeNote(locale);

  return {
    folders: [{ id: "notes", name: locale.startsWith("zh") ? "笔记" : "Notes" }],
    notes: [
      {
        id: "welcome-note",
        folderId: "notes",
        title: welcomeNote.title,
        body: getDraft("welcome-note", welcomeNote.body),
        updatedAt: "2026-04-20T09:00:00.000Z",
      },
    ],
    activeFolderId: "notes",
    activeNoteId: "welcome-note",
  };
}

function normalizeWorkspace(snapshot: WorkspaceSnapshot, locale: string): WorkspaceSnapshot {
  const fallback = createDefaultWorkspace(locale);
  const folders = snapshot.folders.length > 0 ? snapshot.folders : fallback.folders;
  const folderIds = new Set(folders.map((folder) => folder.id));
  const notes = snapshot.notes
    .filter((note) => folderIds.has(note.folderId))
    .map((note) => ({
      ...note,
      body: getDraft(note.id, note.body),
      updatedAt: note.updatedAt || new Date().toISOString(),
    }));
  const normalizedNotes = notes.length > 0 ? notes : fallback.notes;
  const activeFolderId = folderIds.has(snapshot.activeFolderId)
    ? snapshot.activeFolderId
    : folders[0]?.id ?? "";
  const activeNote =
    normalizedNotes.find((note) => note.id === snapshot.activeNoteId) ??
    normalizedNotes.find((note) => note.folderId === activeFolderId) ??
    normalizedNotes[0] ??
    null;

  return {
    folders,
    notes: normalizedNotes,
    activeFolderId: activeNote?.folderId ?? activeFolderId,
    activeNoteId: activeNote?.id ?? "",
  };
}

function loadWorkspace(locale: string) {
  const persisted = getWorkspaceSnapshot();
  return normalizeWorkspace(persisted ?? createDefaultWorkspace(locale), locale);
}

function formatNoteTitle(note: WorkspaceNote) {
  const trimmedTitle = note.title.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  return deriveTitleFromBody(note.body);
}

function deriveTitleFromBody(body: string) {
  const firstLine = body
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);

  return firstLine ?? "Untitled";
}

function summarizeNote(body: string) {
  const summary = body.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (!summary) {
    return "";
  }

  return summary.length > 120 ? `${summary.slice(0, 120).trimEnd()}...` : summary;
}

function sortNotes(notes: WorkspaceNote[]) {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function filterNotes(
  notes: WorkspaceNote[],
  query: string,
  folderNameById: Map<string, string>,
  activeFolderId: string,
) {
  if (!query) {
    return notes.filter((note) => note.folderId === activeFolderId);
  }

  return notes.filter((note) => {
    const haystack = `${formatNoteTitle(note)}\n${note.body}\n${folderNameById.get(note.folderId) ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function groupNotes(
  notes: WorkspaceNote[],
  locale: string,
  folderNameById: Map<string, string>,
  includeFolderName: boolean,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const now = Date.now();
  const grouped = new Map<string, NoteItem[]>();

  for (const note of sortNotes(notes)) {
    const diffDays = Math.floor((now - new Date(note.updatedAt).getTime()) / 86_400_000);
    const label =
      diffDays <= 7
        ? t("noteList.group.7d")
        : diffDays <= 30
          ? t("noteList.group.30d")
          : t("noteList.group.older");
    const items = grouped.get(label) ?? [];
    items.push({
      id: note.id,
      title: formatNoteTitle(note),
      preview: summarizeNote(note.body),
      date: new Intl.DateTimeFormat(locale.startsWith("zh") ? "zh-CN" : "en-US", {
        month: "short",
        day: "numeric",
      }).format(new Date(note.updatedAt)),
      folderName: includeFolderName ? folderNameById.get(note.folderId) : undefined,
    });
    grouped.set(label, items);
  }

  return Array.from(grouped.entries()).map(([label, items]) => ({ label, items })) satisfies NoteSection[];
}

export function useAppModel() {
  const locale = detectLocale();
  const i18n = useMemo(() => createI18n(locale), [locale]);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [workspace, setWorkspace] = useState(() => loadWorkspace(i18n.locale));
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  const [mobileView, setMobileView] = useState<MobileView>("folders");
  const [newNoteId, setNewNoteId] = useState<string | null>(null);
  const [syncStatus, setSyncStatusState] = useState<SyncStatus>(() => getSyncStatus());
  const lastSavedWorkspaceRef = useRef(serializeWorkspace(workspace));
  const lastSavedSyncStatusRef = useRef(syncStatus);
  const unsyncedVersionRef = useRef(syncStatus === "unsynced" ? 1 : 0);

  const applyObservedSyncStatus = (status: SyncStatus) => {
    if (status === "unsynced") {
      unsyncedVersionRef.current += 1;
    }

    lastSavedSyncStatusRef.current = status;
    setSyncStatusState(status);
  };

  const markLocalUnsynced = () => {
    unsyncedVersionRef.current += 1;
    lastSavedSyncStatusRef.current = "unsynced";
    setSyncStatusState("unsynced");
  };

  const commitSyncStatus = (status: SyncStatus) => {
    if (status === "unsynced") {
      unsyncedVersionRef.current += 1;
    }

    lastSavedSyncStatusRef.current = status;
    setSyncStatusState(status);
    setSyncStatus(status);
  };

  useEffect(() => {
    const serializedWorkspace = serializeWorkspace(workspace);
    if (serializedWorkspace !== lastSavedWorkspaceRef.current) {
      saveWorkspaceSnapshot(workspace);
      lastSavedWorkspaceRef.current = serializedWorkspace;
    }
  }, [workspace]);

  useEffect(() => {
    return subscribeToStorageState(() => {
      const nextWorkspace = getWorkspaceSnapshot();
      const nextSyncStatus = getSyncStatus();

      if (nextWorkspace) {
        const normalized = normalizeWorkspace(nextWorkspace, i18n.locale);
        const serialized = serializeWorkspace(normalized);
        if (serialized !== lastSavedWorkspaceRef.current) {
          lastSavedWorkspaceRef.current = serialized;
          setWorkspace(normalized);
        }
      }

      if (nextSyncStatus !== lastSavedSyncStatusRef.current) {
        applyObservedSyncStatus(nextSyncStatus);
      }
    });
  }, [i18n.locale]);

  useEffect(() => {
    return startBackgroundSync(async () => {
      if (getSyncStatus() !== "unsynced") {
        return;
      }

      const runVersion = unsyncedVersionRef.current;
      commitSyncStatus("syncing");
      await Promise.resolve();

      if (getSyncStatus() === "unsynced" || unsyncedVersionRef.current !== runVersion) {
        return;
      }

      commitSyncStatus("idle");
    });
  }, []);

  useEffect(() => {
    setMobileView(isMobile ? "folders" : "editor");
  }, [isMobile]);

  useEffect(() => {
    if (!newNoteId) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNewNoteId(null), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [newNoteId]);

  const folderNameById = useMemo(
    () => new Map(workspace.folders.map((folder) => [folder.id, folder.name])),
    [workspace.folders],
  );
  const folders = useMemo(
    () =>
      workspace.folders.map((folder) => ({
        ...folder,
        count: workspace.notes.filter((note) => note.folderId === folder.id).length,
      })),
    [workspace.folders, workspace.notes],
  );
  const activeFolder =
    workspace.folders.find((folder) => folder.id === workspace.activeFolderId) ?? workspace.folders[0] ?? null;
  const notesInScope = useMemo(
    () => filterNotes(workspace.notes, deferredSearchQuery, folderNameById, activeFolder?.id ?? ""),
    [workspace.notes, deferredSearchQuery, folderNameById, activeFolder],
  );
  const activeNote =
    workspace.notes.find((note) => note.id === workspace.activeNoteId) ??
    notesInScope[0] ??
    null;
  const noteSections = useMemo(
    () => groupNotes(notesInScope, i18n.locale, folderNameById, Boolean(deferredSearchQuery), i18n.t),
    [notesInScope, i18n.locale, i18n.t, folderNameById, deferredSearchQuery],
  );

  const selectFolder = (folderId: string) => {
    setWorkspace((current) => {
      const nextNotes = sortNotes(current.notes.filter((note) => note.folderId === folderId));
      return {
        ...current,
        activeFolderId: folderId,
        activeNoteId: nextNotes[0]?.id ?? "",
      };
    });
    setSearchQuery("");
    setMobileView(isMobile ? "notes" : "editor");
  };

  const createFolder = () => {
    const defaultName = i18n.locale.startsWith("zh") ? "新建文件夹" : "New Folder";
    const name = window.prompt(defaultName, defaultName)?.trim();
    if (!name) {
      return;
    }

    const folderId = createId("folder");
    setWorkspace((current) => ({
      ...current,
      folders: [...current.folders, { id: folderId, name }],
      activeFolderId: folderId,
      activeNoteId: "",
    }));
    commitSyncStatus("unsynced");
    setSearchQuery("");
    setMobileView(isMobile ? "notes" : "editor");
  };

  const createNote = () => {
    const folderId =
      isMobile && mobileView === "folders"
        ? workspace.folders[0]?.id
        : activeFolder?.id ?? workspace.activeFolderId ?? workspace.folders[0]?.id;
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
    setSearchQuery("");
    setNewNoteId(noteId);
    markLocalUnsynced();
    setMobileView("editor");
  };

  const selectNote = (noteId: string) => {
    const nextNote = workspace.notes.find((note) => note.id === noteId);
    setWorkspace((current) => ({
      ...current,
      activeFolderId: nextNote?.folderId ?? current.activeFolderId,
      activeNoteId: noteId,
    }));
    setMobileView("editor");
  };

  const changeBody = (body: string) => {
    if (!activeNote) {
      return;
    }

    const updatedAt = new Date().toISOString();
    saveDraft(activeNote.id, body);
    setWorkspace((current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === activeNote.id
          ? {
              ...note,
              body,
              title: deriveTitleFromBody(body),
              updatedAt,
            }
          : note,
      ),
    }));
    markLocalUnsynced();
  };

  return {
    i18n,
    isMobile,
    folders,
    activeFolder,
    activeNote,
    searchQuery,
    noteSections,
    notesInScope,
    mobileView,
    newNoteId,
    syncStatus,
    setSearchQuery,
    selectFolder,
    createFolder,
    createNote,
    selectNote,
    changeBody,
    setMobileView,
  };
}

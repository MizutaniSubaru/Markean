import { createApiClient } from "@markean/api-client";
import { markdownToPlainText } from "@markean/domain";
import type { FolderRecord, NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { createWebDatabase } from "@markean/storage-web";
import { getWelcomeNote } from "../components/shared/WelcomeNote";
import { getAllFolders } from "../features/notes/persistence/folders.persistence";
import { getDb, initDb } from "../features/notes/persistence/db";
import { getAllNotes } from "../features/notes/persistence/notes.persistence";
import { createSyncScheduler } from "../features/notes/sync/sync.scheduler";
import { createSyncService } from "../features/notes/sync/sync.service";
import { useEditorStore } from "../features/notes/store/editor.store";
import { useFoldersStore } from "../features/notes/store/folders.store";
import { useNotesStore } from "../features/notes/store/notes.store";

const WORKSPACE_KEY = "markean:workspace";
const DRAFT_PREFIX = "markean:draft:";
const SYNC_STATUS_KEY = "markean:sync-status";
const LOCALE_KEY = "markean:locale";

type LegacyWorkspace = {
  folders: Array<{ id: string; name: string }>;
  notes: Array<{
    id: string;
    folderId: string;
    title: string;
    body: string;
    updatedAt: string;
  }>;
  activeFolderId: string;
  activeNoteId: string;
};

function isLegacyFolder(value: unknown): value is LegacyWorkspace["folders"][number] {
  if (!value || typeof value !== "object") return false;
  const folder = value as Record<string, unknown>;
  return typeof folder.id === "string" && typeof folder.name === "string";
}

function isLegacyNote(value: unknown): value is LegacyWorkspace["notes"][number] {
  if (!value || typeof value !== "object") return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    typeof note.folderId === "string" &&
    typeof note.title === "string" &&
    typeof note.body === "string" &&
    typeof note.updatedAt === "string"
  );
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLocalStorage(key: string): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocalStorage(key: string): void {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.removeItem(key);
  } catch {
    // Storage may be unavailable in private or non-browser contexts.
  }
}

export async function migrateFromLocalStorage(): Promise<void> {
  const db = getDb();
  const existingCount = (await db.notes.count()) + (await db.folders.count());
  if (existingCount > 0) return;

  const raw = readLocalStorage(WORKSPACE_KEY);
  if (!raw) return;

  let workspace: LegacyWorkspace;
  try {
    workspace = JSON.parse(raw) as LegacyWorkspace;
  } catch {
    return;
  }

  if (!workspace || typeof workspace !== "object") return;
  if (!Array.isArray(workspace.folders) || !Array.isArray(workspace.notes)) return;
  if (!workspace.folders.every(isLegacyFolder)) return;
  if (!workspace.notes.every(isLegacyNote)) return;

  const now = new Date().toISOString();
  const folders: FolderRecord[] = workspace.folders.map((folder, index) => ({
    id: folder.id,
    name: folder.name,
    sortOrder: index,
    currentRevision: 0,
    updatedAt: now,
    deletedAt: null,
  }));

  const notes: NoteRecord[] = workspace.notes.map((note) => {
    const bodyMd = readLocalStorage(`${DRAFT_PREFIX}${note.id}`) ?? note.body;

    return {
      id: note.id,
      folderId: note.folderId,
      title: note.title,
      bodyMd,
      bodyPlain: markdownToPlainText(bodyMd),
      currentRevision: 0,
      updatedAt: note.updatedAt || now,
      deletedAt: null,
    };
  });

  await db.transaction("rw", db.folders, db.notes, db.pendingChanges, async () => {
    await db.folders.bulkPut(folders);
    await db.notes.bulkPut(notes);
    for (const folder of folders) {
      await queueChange(db, {
        entityType: "folder",
        entityId: folder.id,
        operation: "create",
        baseRevision: 0,
      });
    }
    for (const note of notes) {
      await queueChange(db, {
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
      });
    }
  });

  removeLocalStorage(WORKSPACE_KEY);
  for (const note of workspace.notes) {
    removeLocalStorage(`${DRAFT_PREFIX}${note.id}`);
  }
  removeLocalStorage(SYNC_STATUS_KEY);
}

function detectLocale(): string {
  const stored = readLocalStorage(LOCALE_KEY);
  if (stored) return stored.startsWith("zh") ? "zh" : "en";

  if (typeof navigator === "undefined") return "en";
  return navigator.language.startsWith("zh") ? "zh" : "en";
}

async function ensureWelcomeNote(): Promise<void> {
  const db = getDb();
  const existingCount = (await db.notes.count()) + (await db.folders.count());
  if (existingCount > 0) return;

  const locale = detectLocale();
  const welcome = getWelcomeNote(locale);
  const folderId = "notes";
  const now = new Date().toISOString();

  await db.transaction("rw", db.folders, db.notes, db.pendingChanges, async () => {
    await db.folders.put({
      id: folderId,
      name: locale.startsWith("zh") ? "笔记" : "Notes",
      sortOrder: 0,
      currentRevision: 0,
      updatedAt: now,
      deletedAt: null,
    });
    await queueChange(db, {
      entityType: "folder",
      entityId: folderId,
      operation: "create",
      baseRevision: 0,
    });

    await db.notes.put({
      id: "welcome-note",
      folderId,
      title: welcome.title,
      bodyMd: welcome.body,
      bodyPlain: markdownToPlainText(welcome.body),
      currentRevision: 0,
      updatedAt: now,
      deletedAt: null,
    });
    await queueChange(db, {
      entityType: "note",
      entityId: "welcome-note",
      operation: "create",
      baseRevision: 0,
    });
  });
}

let scheduler: ReturnType<typeof createSyncScheduler> | null = null;

export function getScheduler(): ReturnType<typeof createSyncScheduler> | null {
  return scheduler;
}

export function resetSchedulerForTests(): void {
  scheduler?.stop();
  scheduler = null;
}

export async function bootstrapApp(baseUrl = ""): Promise<void> {
  scheduler?.stop();

  const db = createWebDatabase("markean");
  const apiClient = createApiClient(baseUrl);
  initDb(db);

  await migrateFromLocalStorage();
  await ensureWelcomeNote();

  const [localNotes, localFolders] = await Promise.all([getAllNotes(), getAllFolders()]);
  useNotesStore.getState().loadNotes(localNotes);
  useFoldersStore.getState().loadFolders(localFolders);

  const activeFolders = localFolders.filter((folder) => !folder.deletedAt);
  const activeNotes = localNotes.filter((note) => !note.deletedAt);
  const firstFolder = activeFolders[0];
  if (firstFolder) {
    useEditorStore.getState().selectFolder(firstFolder.id);
    const firstNote = activeNotes.find((note) => note.folderId === firstFolder.id);
    if (firstNote) {
      useEditorStore.getState().selectNote(firstNote.id);
    }
  }

  const syncService = createSyncService(apiClient);
  scheduler = createSyncScheduler(syncService.executeSyncCycle);

  try {
    const bootstrap = await apiClient.bootstrap();
    const serverNotes = Array.isArray(bootstrap.notes)
      ? (bootstrap.notes as NoteRecord[])
      : [];
    const serverFolders = Array.isArray(bootstrap.folders)
      ? (bootstrap.folders as FolderRecord[])
      : [];

    await db.transaction("rw", db.notes, db.folders, db.pendingChanges, db.syncState, async () => {
      for (const note of serverNotes) {
        const pendingChanges = await db.pendingChanges.where("entityId").equals(note.id).toArray();
        if (pendingChanges.some((change) => change.entityType === "note")) continue;

        const local = await db.notes.get(note.id);
        if (!local || (note.currentRevision ?? 0) > (local.currentRevision ?? 0)) {
          await db.notes.put(note);
        }
      }

      for (const folder of serverFolders) {
        const pendingChanges = await db.pendingChanges
          .where("entityId")
          .equals(folder.id)
          .toArray();
        if (pendingChanges.some((change) => change.entityType === "folder")) continue;

        const local = await db.folders.get(folder.id);
        if (!local || (folder.currentRevision ?? 0) > (local.currentRevision ?? 0)) {
          await db.folders.put(folder);
        }
      }

      await db.syncState.put({
        key: "syncCursor",
        value: String(bootstrap.syncCursor ?? 0),
      });
    });

    const [freshNotes, freshFolders] = await Promise.all([getAllNotes(), getAllFolders()]);
    useNotesStore.getState().loadNotes(freshNotes);
    useFoldersStore.getState().loadFolders(freshFolders);
  } catch {
    // Local data is already loaded; remote bootstrap can recover on the scheduler.
  }

  scheduler.start();
}

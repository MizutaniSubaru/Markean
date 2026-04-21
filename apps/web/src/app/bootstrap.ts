import { createApiClient } from "@markean/api-client";
import { markdownToPlainText } from "@markean/domain";
import type { FolderRecord, NoteRecord } from "@markean/domain";
import { createWebDatabase } from "@markean/storage-web";
import { detectLocale } from "../i18n";
import { getWelcomeNote } from "../features/notes/components/shared/WelcomeNote";
import { getAllFolders } from "../features/notes/persistence/folders.persistence";
import { getDb, initDb } from "../features/notes/persistence/db";
import { getAllNotes } from "../features/notes/persistence/notes.persistence";
import { useFoldersStore } from "../features/notes/store/folders.store";
import { useEditorStore } from "../features/notes/store/editor.store";
import { useNotesStore } from "../features/notes/store/notes.store";
import { createSyncScheduler } from "../features/notes/sync/sync.scheduler";
import { createSyncService } from "../features/notes/sync/sync.service";

const WORKSPACE_KEY = "markean:workspace";
const DRAFT_PREFIX = "markean:draft:";
const SYNC_STATUS_KEY = "markean:sync-status";

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

let scheduler: ReturnType<typeof createSyncScheduler> | null = null;

export function getScheduler() {
  return scheduler;
}

export async function migrateFromLocalStorage(): Promise<void> {
  const db = getDb();
  const noteCount = await db.notes.count();
  const folderCount = await db.folders.count();

  if (noteCount + folderCount > 0) {
    return;
  }

  const raw = localStorage.getItem(WORKSPACE_KEY);
  if (!raw) {
    return;
  }

  let workspace: LegacyWorkspace;
  try {
    workspace = JSON.parse(raw);
  } catch {
    return;
  }

  if (!Array.isArray(workspace.folders) || !Array.isArray(workspace.notes)) {
    return;
  }

  const folders: FolderRecord[] = workspace.folders.map((folder, index) => ({
    id: folder.id,
    name: folder.name,
    sortOrder: index,
    currentRevision: 0,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  }));

  const notes: NoteRecord[] = workspace.notes.map((note) => {
    const draft = localStorage.getItem(`${DRAFT_PREFIX}${note.id}`);
    const bodyMd = draft ?? note.body;

    return {
      id: note.id,
      folderId: note.folderId,
      title: note.title,
      bodyMd,
      bodyPlain: markdownToPlainText(bodyMd),
      currentRevision: 0,
      updatedAt: note.updatedAt || new Date().toISOString(),
      deletedAt: null,
    };
  });

  await db.transaction("rw", db.folders, db.notes, async () => {
    await db.folders.bulkPut(folders);
    await db.notes.bulkPut(notes);
  });

  localStorage.removeItem(WORKSPACE_KEY);
  for (const note of workspace.notes) {
    localStorage.removeItem(`${DRAFT_PREFIX}${note.id}`);
  }
  localStorage.removeItem(SYNC_STATUS_KEY);
}

async function ensureWelcomeNote(): Promise<void> {
  const db = getDb();
  const noteCount = await db.notes.count();
  const folderCount = await db.folders.count();

  if (noteCount > 0 || folderCount > 0) {
    return;
  }

  const locale = detectLocale();
  const welcome = getWelcomeNote(locale);
  const folderId = "notes";
  const folderName = locale.startsWith("zh") ? "笔记" : "Notes";
  const now = new Date().toISOString();

  await db.folders.put({
    id: folderId,
    name: folderName,
    sortOrder: 0,
    currentRevision: 0,
    updatedAt: now,
    deletedAt: null,
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
}

export async function bootstrapApp(baseUrl = ""): Promise<void> {
  const db = createWebDatabase("markean");
  initDb(db);

  await migrateFromLocalStorage();
  await ensureWelcomeNote();

  const [localNotes, localFolders] = await Promise.all([getAllNotes(), getAllFolders()]);
  useNotesStore.getState().loadNotes(localNotes);
  useFoldersStore.getState().loadFolders(localFolders);

  const activeFolders = localFolders.filter((folder) => !folder.deletedAt);
  const activeNotes = localNotes.filter((note) => !note.deletedAt);
  if (activeFolders.length > 0) {
    useEditorStore.getState().selectFolder(activeFolders[0].id);
    const firstNote = activeNotes.find((note) => note.folderId === activeFolders[0].id);
    if (firstNote) {
      useEditorStore.getState().selectNote(firstNote.id);
    }
  }

  const apiClient = createApiClient(baseUrl);
  const syncService = createSyncService(apiClient);
  scheduler?.stop();
  scheduler = createSyncScheduler(syncService.executeSyncCycle);

  try {
    const bootstrap = await apiClient.bootstrap();
    const serverNotes = (bootstrap.notes ?? []) as NoteRecord[];
    const serverFolders = (bootstrap.folders ?? []) as FolderRecord[];

    await db.transaction("rw", db.notes, db.folders, db.syncState, async () => {
      for (const note of serverNotes) {
        const local = await db.notes.get(note.id);
        if (!local || note.currentRevision > local.currentRevision) {
          await db.notes.put(note);
        }
      }

      for (const folder of serverFolders) {
        const local = await db.folders.get(folder.id);
        if (!local || folder.currentRevision > local.currentRevision) {
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
    // Fall back to local data when bootstrap fails.
  }

  scheduler.start();
}

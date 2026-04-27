import { createApiClient } from "@markean/api-client";
import { markdownToPlainText } from "@markean/domain";
import type { FolderRecord, NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { createWebDatabase, type MarkeanWebDatabase } from "@markean/storage-web";
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

type MigrationSelection = {
  activeFolderId: string;
  activeNoteId: string;
};

type BootstrapConcurrencyHooks = {
  beforeMigrationWrite?: () => Promise<void> | void;
  afterMigration?: () => Promise<void> | void;
  beforeWelcomeWrite?: () => Promise<void> | void;
  beforeRemoteWrite?: () => Promise<void> | void;
};

let concurrencyHooks: BootstrapConcurrencyHooks = {};

export function setBootstrapConcurrencyHooksForTests(hooks: BootstrapConcurrencyHooks): void {
  concurrencyHooks = hooks;
}

class StaleBootstrapError extends Error {
  constructor() {
    super("Stale bootstrap run");
  }
}

function isValidBootstrapResponse(
  value: unknown,
  existingFolderIds: Set<string>,
): value is { folders: FolderRecord[]; notes: NoteRecord[]; syncCursor: number } {
  if (!value || typeof value !== "object") return false;
  const bootstrap = value as Record<string, unknown>;
  if (!Array.isArray(bootstrap.folders)) return false;
  if (!Array.isArray(bootstrap.notes)) return false;
  if (typeof bootstrap.syncCursor !== "number") return false;
  if (!isNonNegativeInteger(bootstrap.syncCursor)) return false;
  if (!bootstrap.folders.every(isRemoteFolderRecord)) return false;
  if (!bootstrap.notes.every(isRemoteNoteRecord)) return false;
  if (!hasUniqueIds(bootstrap.folders)) return false;
  if (!hasUniqueIds(bootstrap.notes)) return false;

  const remoteFolderIds = new Set(bootstrap.folders.map((folder) => folder.id));
  return bootstrap.notes.every(
    (note) =>
      existingFolderIds.has(note.folderId) || remoteFolderIds.has(note.folderId),
  );
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function hasUniqueIds(records: Array<{ id: string }>): boolean {
  return new Set(records.map((record) => record.id)).size === records.length;
}

function isRemoteFolderRecord(value: unknown): value is FolderRecord {
  if (!value || typeof value !== "object") return false;
  const folder = value as Record<string, unknown>;
  return (
    typeof folder.id === "string" &&
    isNonBlank(folder.id) &&
    typeof folder.name === "string" &&
    typeof folder.sortOrder === "number" &&
    Number.isFinite(folder.sortOrder) &&
    typeof folder.currentRevision === "number" &&
    isNonNegativeInteger(folder.currentRevision) &&
    typeof folder.updatedAt === "string" &&
    folder.deletedAt === null
  );
}

function isRemoteNoteRecord(value: unknown): value is NoteRecord {
  if (!value || typeof value !== "object") return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    isNonBlank(note.id) &&
    typeof note.folderId === "string" &&
    isNonBlank(note.folderId) &&
    typeof note.title === "string" &&
    typeof note.bodyMd === "string" &&
    typeof note.bodyPlain === "string" &&
    typeof note.currentRevision === "number" &&
    isNonNegativeInteger(note.currentRevision) &&
    typeof note.updatedAt === "string" &&
    note.deletedAt === null
  );
}

function isLegacyFolder(value: unknown): value is LegacyWorkspace["folders"][number] {
  if (!value || typeof value !== "object") return false;
  const folder = value as Record<string, unknown>;
  return (
    typeof folder.id === "string" &&
    isNonBlank(folder.id) &&
    typeof folder.name === "string"
  );
}

function isLegacyNote(value: unknown): value is LegacyWorkspace["notes"][number] {
  if (!value || typeof value !== "object") return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    isNonBlank(note.id) &&
    typeof note.folderId === "string" &&
    isNonBlank(note.folderId) &&
    typeof note.title === "string" &&
    typeof note.body === "string" &&
    typeof note.updatedAt === "string"
  );
}

function hasValidLegacyReferences(workspace: LegacyWorkspace): boolean {
  const folderIds = new Set(workspace.folders.map((folder) => folder.id));
  if (folderIds.size !== workspace.folders.length) return false;

  const notesById = new Map(workspace.notes.map((note) => [note.id, note]));
  if (notesById.size !== workspace.notes.length) return false;

  if (workspace.activeFolderId !== "" && !folderIds.has(workspace.activeFolderId)) {
    return false;
  }

  if (workspace.activeFolderId === "" && workspace.activeNoteId !== "") {
    return false;
  }

  if (workspace.activeNoteId !== "" && !notesById.has(workspace.activeNoteId)) {
    return false;
  }

  if (workspace.notes.some((note) => !folderIds.has(note.folderId))) {
    return false;
  }

  if (workspace.activeFolderId !== "" && workspace.activeNoteId !== "") {
    return notesById.get(workspace.activeNoteId)?.folderId === workspace.activeFolderId;
  }

  return true;
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

function removeLegacyDrafts(): void {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    const draftKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) {
        draftKeys.push(key);
      }
    }

    for (const key of draftKeys) {
      storage.removeItem(key);
    }
  } catch {
    // Storage enumeration/removal can fail in restricted browser contexts.
  }
}

async function queueCreateChangeOnce(
  db: MarkeanWebDatabase,
  entityType: "folder" | "note",
  entityId: string,
): Promise<void> {
  const existing = await db.pendingChanges.where("entityId").equals(entityId).toArray();
  if (
    existing.some(
      (change) => change.entityType === entityType && change.operation === "create",
    )
  ) {
    return;
  }

  await queueChange(db, {
    entityType,
    entityId,
    operation: "create",
    baseRevision: 0,
  });
}

async function migrateFromLocalStorageInternal(): Promise<MigrationSelection | null> {
  const db = getDb();
  const existingCount = (await db.notes.count()) + (await db.folders.count());
  if (existingCount > 0) return null;

  const raw = readLocalStorage(WORKSPACE_KEY);
  if (!raw) return null;

  let workspace: LegacyWorkspace;
  try {
    workspace = JSON.parse(raw) as LegacyWorkspace;
  } catch {
    return null;
  }

  if (!workspace || typeof workspace !== "object") return null;
  if (!Array.isArray(workspace.folders) || !Array.isArray(workspace.notes)) return null;
  if (typeof workspace.activeFolderId !== "string") return null;
  if (typeof workspace.activeNoteId !== "string") return null;
  if (!workspace.folders.every(isLegacyFolder)) return null;
  if (!workspace.notes.every(isLegacyNote)) return null;
  if (!hasValidLegacyReferences(workspace)) return null;

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

  let didMigrate = false;
  await db.transaction("rw", db.folders, db.notes, db.pendingChanges, async () => {
    await concurrencyHooks.beforeMigrationWrite?.();
    const existingCountInTransaction =
      (await db.notes.count()) + (await db.folders.count());
    if (existingCountInTransaction > 0) return;

    await db.folders.bulkPut(folders);
    await db.notes.bulkPut(notes);
    for (const folder of folders) {
      await queueCreateChangeOnce(db, "folder", folder.id);
    }
    for (const note of notes) {
      await queueCreateChangeOnce(db, "note", note.id);
    }
    didMigrate = true;
  });

  if (!didMigrate) return null;

  removeLocalStorage(WORKSPACE_KEY);
  removeLegacyDrafts();
  removeLocalStorage(SYNC_STATUS_KEY);

  return {
    activeFolderId: workspace.activeFolderId,
    activeNoteId: workspace.activeNoteId,
  };
}

export async function migrateFromLocalStorage(): Promise<void> {
  await migrateFromLocalStorageInternal();
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
    await concurrencyHooks.beforeWelcomeWrite?.();
    const existingCountInTransaction =
      (await db.notes.count()) + (await db.folders.count());
    if (existingCountInTransaction > 0) return;

    await db.folders.put({
      id: folderId,
      name: locale.startsWith("zh") ? "笔记" : "Notes",
      sortOrder: 0,
      currentRevision: 0,
      updatedAt: now,
      deletedAt: null,
    });
    await queueCreateChangeOnce(db, "folder", folderId);

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
    await queueCreateChangeOnce(db, "note", "welcome-note");
  });
}

let scheduler: ReturnType<typeof createSyncScheduler> | null = null;
let bootstrapGeneration = 0;
let pendingMigratedSelection: MigrationSelection | null = null;

export function getScheduler(): ReturnType<typeof createSyncScheduler> | null {
  return scheduler;
}

export function resetSchedulerForTests(): void {
  bootstrapGeneration += 1;
  scheduler?.stop();
  scheduler = null;
  concurrencyHooks = {};
  pendingMigratedSelection = null;
}

function restoreEditorSelection(
  localNotes: NoteRecord[],
  localFolders: FolderRecord[],
  migratedSelection: MigrationSelection | null,
): void {
  const activeFolders = localFolders.filter((folder) => !folder.deletedAt);
  const activeNotes = localNotes.filter((note) => !note.deletedAt);

  if (migratedSelection !== null) {
    useEditorStore.getState().selectFolder(migratedSelection.activeFolderId);
    useEditorStore.getState().selectNote(migratedSelection.activeNoteId);
    return;
  }

  const firstFolder = activeFolders[0];
  if (firstFolder) {
    useEditorStore.getState().selectFolder(firstFolder.id);
    const firstNote = activeNotes.find((note) => note.folderId === firstFolder.id);
    if (firstNote) {
      useEditorStore.getState().selectNote(firstNote.id);
    } else {
      useEditorStore.getState().selectNote("");
    }
    return;
  }

  useEditorStore.getState().selectFolder("");
  useEditorStore.getState().selectNote("");
}

function revalidateEditorSelection(
  localNotes: NoteRecord[],
  localFolders: FolderRecord[],
): void {
  const activeFolders = localFolders.filter((folder) => !folder.deletedAt);
  const activeNotes = localNotes.filter((note) => !note.deletedAt);
  const { activeFolderId, activeNoteId } = useEditorStore.getState();
  if (activeFolderId === "" && activeNoteId === "") return;

  const selectedFolder = activeFolders.find((folder) => folder.id === activeFolderId);

  if (!selectedFolder) {
    restoreEditorSelection(localNotes, localFolders, null);
    return;
  }

  const selectedNote = activeNotes.find(
    (note) => note.id === activeNoteId && note.folderId === selectedFolder.id,
  );
  if (selectedNote) return;

  const firstNoteInSelectedFolder = activeNotes.find(
    (note) => note.folderId === selectedFolder.id,
  );
  useEditorStore.getState().selectFolder(selectedFolder.id);
  useEditorStore.getState().selectNote(firstNoteInSelectedFolder?.id ?? "");
}

export async function bootstrapApp(baseUrl = ""): Promise<void> {
  const generation = bootstrapGeneration + 1;
  bootstrapGeneration = generation;
  scheduler?.stop();
  scheduler = null;

  const db = createWebDatabase("markean");
  const apiClient = createApiClient(baseUrl);
  initDb(db);
  const isStale = () => generation !== bootstrapGeneration;

  const migratedSelection = await migrateFromLocalStorageInternal();
  if (migratedSelection !== null) {
    pendingMigratedSelection = migratedSelection;
  }
  await concurrencyHooks.afterMigration?.();
  if (isStale()) {
    db.close();
    return;
  }
  await ensureWelcomeNote();
  if (isStale()) {
    db.close();
    return;
  }

  const [localNotes, localFolders] = await Promise.all([getAllNotes(), getAllFolders()]);
  if (isStale()) {
    db.close();
    return;
  }
  useNotesStore.getState().loadNotes(localNotes);
  useFoldersStore.getState().loadFolders(localFolders);
  const selectionToRestore = pendingMigratedSelection ?? migratedSelection;
  const consumedMigratedSelection = selectionToRestore !== null;
  restoreEditorSelection(localNotes, localFolders, selectionToRestore);

  const syncService = createSyncService(apiClient);
  const localScheduler = createSyncScheduler(syncService.executeSyncCycle);

  try {
    const bootstrap = await apiClient.bootstrap();
    if (isStale()) {
      localScheduler.stop();
      db.close();
      return;
    }
    const existingFolderIds = new Set(
      localFolders
        .filter((folder) => !folder.deletedAt)
        .map((folder) => folder.id),
    );
    if (!isValidBootstrapResponse(bootstrap, existingFolderIds)) {
      throw new Error("Invalid bootstrap response");
    }
    const serverNotes = bootstrap.notes;
    const serverFolders = bootstrap.folders;
    const serverNoteIds = new Set(serverNotes.map((note) => note.id));
    const serverFolderIds = new Set(serverFolders.map((folder) => folder.id));
    const serverReferencedFolderIds = new Set(
      serverNotes.map((note) => note.folderId),
    );

    await db.transaction("rw", db.notes, db.folders, db.pendingChanges, db.syncState, async () => {
      await concurrencyHooks.beforeRemoteWrite?.();
      if (isStale()) throw new StaleBootstrapError();
      let skippedPendingBootstrapConflict = false;

      for (const note of serverNotes) {
        const pendingChanges = await db.pendingChanges.where("entityId").equals(note.id).toArray();
        if (pendingChanges.some((change) => change.entityType === "note")) {
          skippedPendingBootstrapConflict = true;
          continue;
        }

        const local = await db.notes.get(note.id);
        if (!local || (note.currentRevision ?? 0) > (local.currentRevision ?? 0)) {
          if (isStale()) throw new StaleBootstrapError();
          await db.notes.put(note);
          if (isStale()) throw new StaleBootstrapError();
        }
      }

      for (const folder of serverFolders) {
        const pendingChanges = await db.pendingChanges
          .where("entityId")
          .equals(folder.id)
          .toArray();
        if (pendingChanges.some((change) => change.entityType === "folder")) {
          skippedPendingBootstrapConflict = true;
          continue;
        }

        const local = await db.folders.get(folder.id);
        if (!local || (folder.currentRevision ?? 0) > (local.currentRevision ?? 0)) {
          if (isStale()) throw new StaleBootstrapError();
          await db.folders.put(folder);
          if (isStale()) throw new StaleBootstrapError();
        }
      }

      const deletedAt = new Date().toISOString();
      const localNotesInTransaction = await db.notes.toArray();
      for (const note of localNotesInTransaction) {
        if (note.deletedAt || serverNoteIds.has(note.id)) continue;

        const pendingChanges = await db.pendingChanges.where("entityId").equals(note.id).toArray();
        if (pendingChanges.some((change) => change.entityType === "note")) continue;

        if (isStale()) throw new StaleBootstrapError();
        await db.notes.put({ ...note, deletedAt });
        if (isStale()) throw new StaleBootstrapError();
      }

      const localFoldersInTransaction = await db.folders.toArray();
      for (const folder of localFoldersInTransaction) {
        if (folder.deletedAt || serverFolderIds.has(folder.id)) continue;
        if (serverReferencedFolderIds.has(folder.id)) continue;

        const pendingChanges = await db.pendingChanges
          .where("entityId")
          .equals(folder.id)
          .toArray();
        if (pendingChanges.some((change) => change.entityType === "folder")) continue;

        if (isStale()) throw new StaleBootstrapError();
        await db.folders.put({ ...folder, deletedAt });
        if (isStale()) throw new StaleBootstrapError();
      }

      if (isStale()) throw new StaleBootstrapError();
      if (!skippedPendingBootstrapConflict) {
        await db.syncState.put({
          key: "syncCursor",
          value: String(bootstrap.syncCursor),
        });
      }
      if (isStale()) throw new StaleBootstrapError();
    });

    const [freshNotes, freshFolders] = await Promise.all([getAllNotes(), getAllFolders()]);
    if (isStale()) {
      localScheduler.stop();
      db.close();
      return;
    }
    useNotesStore.getState().loadNotes(freshNotes);
    useFoldersStore.getState().loadFolders(freshFolders);
    revalidateEditorSelection(freshNotes, freshFolders);
  } catch (error) {
    if (error instanceof StaleBootstrapError) {
      localScheduler.stop();
      db.close();
      return;
    }
    // Local data is already loaded; remote bootstrap can recover on the scheduler.
  }

  if (isStale()) {
    localScheduler.stop();
    db.close();
    return;
  }

  scheduler = localScheduler;
  scheduler.start();
  if (consumedMigratedSelection) {
    pendingMigratedSelection = null;
  }
}

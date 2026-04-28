import { getDeviceId, pullChanges, pushChanges } from "@markean/sync-core";
import { getDb } from "../persistence/db";
import { getAllFolders } from "../persistence/folders.persistence";
import { getAllNotes } from "../persistence/notes.persistence";
import { useEditorStore } from "../store/editor.store";
import { useFoldersStore } from "../store/folders.store";
import { useNotesStore } from "../store/notes.store";
import { useSyncStore } from "../store/sync.store";
import { handleConflicts } from "./conflict.handler";

type ApiClient = Parameters<typeof pushChanges>[1];

type SyncServiceOptions = {
  shouldApply?: () => boolean;
};

function restoreEditorSelection(): void {
  const activeFolders = useFoldersStore
    .getState()
    .folders.filter((folder) => !folder.deletedAt);
  const activeNotes = useNotesStore.getState().notes.filter((note) => !note.deletedAt);
  const firstFolder = activeFolders[0];

  if (!firstFolder) {
    useEditorStore.getState().selectFolder("");
    useEditorStore.getState().selectNote("");
    return;
  }

  const firstNote = activeNotes.find((note) => note.folderId === firstFolder.id);
  useEditorStore.getState().selectFolder(firstFolder.id);
  useEditorStore.getState().selectNote(firstNote?.id ?? "");
}

function revalidateEditorSelection(): void {
  const activeFolders = useFoldersStore
    .getState()
    .folders.filter((folder) => !folder.deletedAt);
  const activeNotes = useNotesStore.getState().notes.filter((note) => !note.deletedAt);
  const { activeFolderId, activeNoteId } = useEditorStore.getState();
  if (activeFolderId === "" && activeNoteId === "") return;

  const selectedFolder = activeFolders.find((folder) => folder.id === activeFolderId);
  if (!selectedFolder) {
    restoreEditorSelection();
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

export function createSyncService(apiClient: ApiClient, options: SyncServiceOptions = {}) {
  let inFlight: Promise<void> | null = null;
  const shouldApply = options.shouldApply ?? (() => true);

  function markCancelled(runId: string): void {
    useSyncStore.getState().markCancelled(runId);
  }

  async function runCycle(): Promise<void> {
    if (!shouldApply()) return;
    const runId = `sync_${crypto.randomUUID()}`;
    useSyncStore.getState().markSyncing(runId);

    try {
      const db = getDb();
      const deviceId = await getDeviceId(db, { shouldApply });
      if (!deviceId || !shouldApply()) {
        markCancelled(runId);
        return;
      }

      const { conflicts } = await pushChanges(db, apiClient, deviceId, { shouldApply });
      if (!shouldApply()) {
        markCancelled(runId);
        return;
      }

      if (conflicts.length > 0) {
        await handleConflicts(conflicts, { shouldApply });
        if (!shouldApply()) {
          markCancelled(runId);
          return;
        }
      }

      await pullChanges(db, apiClient, deviceId, { shouldApply });
      if (!shouldApply()) {
        markCancelled(runId);
        return;
      }

      const [notes, folders] = await Promise.all([getAllNotes(), getAllFolders()]);
      if (!shouldApply()) {
        markCancelled(runId);
        return;
      }

      useNotesStore.getState().loadNotes(notes);
      useFoldersStore.getState().loadFolders(folders);
      revalidateEditorSelection();

      const pendingChanges = await db.pendingChanges.toArray();
      if (!shouldApply()) {
        markCancelled(runId);
        return;
      }

      if (pendingChanges.length === 0) {
        useSyncStore.getState().markSynced();
      } else {
        useSyncStore.getState().markUnsynced();
      }
    } catch {
      if (shouldApply()) {
        useSyncStore.getState().markError();
      } else {
        markCancelled(runId);
      }
    }
  }

  function executeSyncCycle(): Promise<void> {
    if (inFlight) return inFlight;

    inFlight = runCycle().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { executeSyncCycle };
}

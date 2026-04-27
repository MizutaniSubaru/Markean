import { getDeviceId, pullChanges, pushChanges } from "@markean/sync-core";
import { getDb } from "../persistence/db";
import { getAllFolders } from "../persistence/folders.persistence";
import { getAllNotes } from "../persistence/notes.persistence";
import { useFoldersStore } from "../store/folders.store";
import { useNotesStore } from "../store/notes.store";
import { useSyncStore } from "../store/sync.store";
import { handleConflicts } from "./conflict.handler";

type ApiClient = Parameters<typeof pushChanges>[1];

export function createSyncService(apiClient: ApiClient) {
  let inFlight: Promise<void> | null = null;

  async function runCycle(): Promise<void> {
    useSyncStore.getState().markSyncing();

    try {
      const db = getDb();
      const deviceId = await getDeviceId(db);
      const { conflicts } = await pushChanges(db, apiClient, deviceId);

      if (conflicts.length > 0) {
        await handleConflicts(conflicts);
      }

      await pullChanges(db, apiClient, deviceId);

      const [notes, folders] = await Promise.all([getAllNotes(), getAllFolders()]);
      useNotesStore.getState().loadNotes(notes);
      useFoldersStore.getState().loadFolders(folders);

      const pendingChanges = await db.pendingChanges.toArray();
      if (pendingChanges.length === 0) {
        useSyncStore.getState().markSynced();
      } else {
        useSyncStore.getState().markUnsynced();
      }
    } catch {
      useSyncStore.getState().markError();
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

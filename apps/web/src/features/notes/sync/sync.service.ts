import { runSyncCycle } from "@markean/sync-core";
import { getAllFolders } from "../persistence/folders.persistence";
import { getDb } from "../persistence/db";
import { getAllNotes } from "../persistence/notes.persistence";
import { useFoldersStore } from "../store/folders.store";
import { useNotesStore } from "../store/notes.store";
import { useSyncStore } from "../store/sync.store";
import { handleConflicts } from "./conflict.handler";

type ApiClient = Parameters<typeof runSyncCycle>[1];

export function createSyncService(apiClient: ApiClient) {
  async function executeSyncCycle(): Promise<void> {
    useSyncStore.getState().markSyncing();

    try {
      const { conflicts } = await runSyncCycle(getDb(), apiClient);

      if (conflicts.length > 0) {
        await handleConflicts(conflicts);
      }

      const [notes, folders] = await Promise.all([getAllNotes(), getAllFolders()]);
      useNotesStore.getState().loadNotes(notes);
      useFoldersStore.getState().loadFolders(folders);
      useSyncStore.getState().markSynced();
    } catch {
      useSyncStore.getState().markError();
    }
  }

  return { executeSyncCycle };
}

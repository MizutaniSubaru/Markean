import { create } from "zustand";

type SyncStatus = "idle" | "syncing" | "unsynced" | "error";

type SyncState = {
  status: SyncStatus;
  isOnline: boolean;
  lastSyncedAt: string | null;
  activeRunId: string | null;
  markUnsynced: () => void;
  markSyncing: (runId?: string) => void;
  markSynced: () => void;
  markError: (message?: string) => void;
  markCancelled: (runId: string) => void;
  setOnline: (online: boolean) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  status: "idle",
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  lastSyncedAt: null,
  activeRunId: null,

  markUnsynced: () => set({ status: "unsynced", activeRunId: null }),
  markSyncing: (runId) => set({ status: "syncing", activeRunId: runId ?? null }),
  markSynced: () =>
    set({ status: "idle", lastSyncedAt: new Date().toISOString(), activeRunId: null }),
  markError: () => set({ status: "error", activeRunId: null }),
  markCancelled: (runId) =>
    set((state) =>
      state.status === "syncing" && state.activeRunId === runId
        ? { status: "unsynced", activeRunId: null }
        : {},
    ),
  setOnline: (online) => set({ isOnline: online }),
}));

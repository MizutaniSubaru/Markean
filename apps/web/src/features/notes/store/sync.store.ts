import { create } from "zustand";

export type SyncStatus = "idle" | "syncing" | "unsynced" | "error";

type SyncState = {
  status: SyncStatus;
  isOnline: boolean;
  lastSyncedAt: string | null;
  markUnsynced: () => void;
  markSyncing: () => void;
  markSynced: () => void;
  markError: (message?: string) => void;
  setOnline: (online: boolean) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  status: "idle",
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  lastSyncedAt: null,
  markUnsynced: () => set({ status: "unsynced" }),
  markSyncing: () => set({ status: "syncing" }),
  markSynced: () => set({ status: "idle", lastSyncedAt: new Date().toISOString() }),
  markError: () => set({ status: "error" }),
  setOnline: (online) => set({ isOnline: online }),
}));

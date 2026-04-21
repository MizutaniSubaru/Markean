import { afterEach, describe, expect, it } from "vitest";
import { useSyncStore } from "../../src/features/notes/store/sync.store";

describe("sync.store", () => {
  afterEach(() => {
    useSyncStore.setState({
      status: "idle",
      isOnline: true,
      lastSyncedAt: null,
    });
  });

  it("starts with idle status", () => {
    expect(useSyncStore.getState().status).toBe("idle");
  });

  it("transitions to unsynced", () => {
    useSyncStore.getState().markUnsynced();
    expect(useSyncStore.getState().status).toBe("unsynced");
  });

  it("transitions to syncing", () => {
    useSyncStore.getState().markSyncing();
    expect(useSyncStore.getState().status).toBe("syncing");
  });

  it("transitions to synced and records timestamp", () => {
    useSyncStore.getState().markSynced();
    const state = useSyncStore.getState();
    expect(state.status).toBe("idle");
    expect(state.lastSyncedAt).not.toBeNull();
  });

  it("transitions to error", () => {
    useSyncStore.getState().markError("network failure");
    expect(useSyncStore.getState().status).toBe("error");
  });

  it("tracks online/offline", () => {
    useSyncStore.getState().setOnline(false);
    expect(useSyncStore.getState().isOnline).toBe(false);
  });
});

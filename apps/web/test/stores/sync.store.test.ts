import { afterEach, describe, expect, it, vi } from "vitest";
import { useSyncStore } from "../../src/features/notes/store/sync.store";

describe("sync.store", () => {
  afterEach(() => {
    vi.useRealTimers();
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));

    useSyncStore.getState().markSynced();
    const state = useSyncStore.getState();

    expect(state.status).toBe("idle");
    expect(state.lastSyncedAt).toBe("2026-04-27T12:34:56.789Z");
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

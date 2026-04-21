import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncStore } from "../../src/features/notes/store/sync.store";
import { createSyncScheduler } from "../../src/features/notes/sync/sync.scheduler";

describe("sync.scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSyncStore.setState({ status: "idle", isOnline: true, lastSyncedAt: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    useSyncStore.setState({ status: "idle", isOnline: true, lastSyncedAt: null });
  });

  it("runs sync cycle on requestSync after debounce", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.requestSync();
    expect(executeSyncCycle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(executeSyncCycle).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("resets debounce timer on repeated requestSync calls", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(300);
    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(300);

    expect(executeSyncCycle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("runs periodic poll", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(executeSyncCycle).toHaveBeenCalled();
    scheduler.stop();
  });

  it("does not run poll when already syncing", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    useSyncStore.setState({ status: "syncing" });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(executeSyncCycle).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("tracks offline and retries on online", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.start();

    window.dispatchEvent(new Event("offline"));
    expect(useSyncStore.getState().isOnline).toBe(false);

    window.dispatchEvent(new Event("online"));
    expect(useSyncStore.getState().isOnline).toBe(true);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("stop cancels all timers and removes online listeners", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.start();
    scheduler.requestSync();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("online"));

    expect(executeSyncCycle).not.toHaveBeenCalled();
  });
});

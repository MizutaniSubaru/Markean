import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncScheduler } from "../../src/features/notes/sync/sync.scheduler";
import { useSyncStore } from "../../src/features/notes/store/sync.store";

const DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 30_000;

function resetSyncStore(): void {
  useSyncStore.setState({
    status: "idle",
    isOnline: true,
    lastSyncedAt: null,
  });
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe("sync.scheduler", () => {
  const schedulers: Array<ReturnType<typeof createSyncScheduler>> = [];

  function createTrackedScheduler(executeSyncCycle: () => Promise<void>) {
    const scheduler = createSyncScheduler(executeSyncCycle);
    schedulers.push(scheduler);
    return scheduler;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetSyncStore();
  });

  afterEach(() => {
    for (const scheduler of schedulers) {
      scheduler.stop();
    }
    schedulers.length = 0;
    resetSyncStore();
    vi.useRealTimers();
  });

  it("runs sync cycle on requestSync after 500ms debounce", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(executeSyncCycle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);
  });

  it("resets debounce timer on repeated requestSync calls", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(300);
    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(499);
    expect(executeSyncCycle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);
  });

  it("runs periodic poll after 30_000ms", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(executeSyncCycle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);
  });

  it("does not run poll when sync store status is syncing", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.start();
    useSyncStore.getState().markSyncing();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(executeSyncCycle).not.toHaveBeenCalled();
  });

  it("stop cancels all timers", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.start();
    scheduler.requestSync();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(executeSyncCycle).not.toHaveBeenCalled();
  });

  it("online event sets isOnline true and runs sync", () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    useSyncStore.getState().setOnline(false);
    scheduler.start();
    window.dispatchEvent(new Event("online"));

    expect(useSyncStore.getState().isOnline).toBe(true);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);
  });

  it("offline event sets isOnline false and does not run sync", () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.start();
    window.dispatchEvent(new Event("offline"));

    expect(useSyncStore.getState().isOnline).toBe(false);
    expect(executeSyncCycle).not.toHaveBeenCalled();
  });

  it("stop removes online/offline listeners", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.start();
    scheduler.stop();
    useSyncStore.getState().setOnline(false);
    window.dispatchEvent(new Event("online"));
    await vi.runOnlyPendingTimersAsync();
    expect(useSyncStore.getState().isOnline).toBe(false);

    useSyncStore.getState().setOnline(true);
    window.dispatchEvent(new Event("offline"));

    expect(useSyncStore.getState().isOnline).toBe(true);
    expect(executeSyncCycle).not.toHaveBeenCalled();
  });

  it("start is idempotent for intervals and listeners", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    expect(executeSyncCycle).toHaveBeenCalledTimes(2);
  });

  it("runs one retry when requestSync happens while sync is running", async () => {
    const firstCycle = createDeferred();
    const executeSyncCycle = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstCycle.promise)
      .mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);

    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);

    firstCycle.resolve();
    await Promise.resolve();

    expect(executeSyncCycle).toHaveBeenCalledTimes(2);
  });

  it("clears running state after rejection and allows later requestSync", async () => {
    const executeSyncCycle = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValue(undefined);
    const scheduler = createTrackedScheduler(executeSyncCycle);

    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);

    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(executeSyncCycle).toHaveBeenCalledTimes(2);
  });
});

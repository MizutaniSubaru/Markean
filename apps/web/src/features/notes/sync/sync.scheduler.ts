import { useSyncStore } from "../store/sync.store";

const DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 30_000;

export function createSyncScheduler(executeSyncCycle: () => Promise<void>) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let isSyncing = false;
  let pendingRetry = false;
  let isStarted = false;

  const handleOnline = () => {
    useSyncStore.getState().setOnline(true);
    void run();
  };

  const handleOffline = () => {
    useSyncStore.getState().setOnline(false);
  };

  async function run(): Promise<void> {
    if (isSyncing) {
      pendingRetry = true;
      return;
    }

    isSyncing = true;
    try {
      await executeSyncCycle();
    } catch {
      // The sync service owns error state; the scheduler only keeps future runs unblocked.
    } finally {
      isSyncing = false;
      if (pendingRetry) {
        pendingRetry = false;
        void run();
      }
    }
  }

  function requestSync(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void run();
    }, DEBOUNCE_MS);
  }

  function start(): void {
    if (isStarted) return;
    isStarted = true;

    pollTimer = setInterval(() => {
      const { status } = useSyncStore.getState();
      if (status === "syncing") return;
      void run();
    }, POLL_INTERVAL_MS);

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }
  }

  function stop(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (isStarted && typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    }
    isStarted = false;
  }

  return { requestSync, start, stop };
}

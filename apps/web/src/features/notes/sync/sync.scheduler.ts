import { useSyncStore } from "../store/sync.store";

const DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 30_000;

export function createSyncScheduler(executeSyncCycle: () => Promise<void>) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let isSyncing = false;
  let pendingRetry = false;
  let removeOnlineListeners: (() => void) | null = null;

  async function run(): Promise<void> {
    if (isSyncing) {
      pendingRetry = true;
      return;
    }

    isSyncing = true;

    try {
      await executeSyncCycle();
    } finally {
      isSyncing = false;

      if (pendingRetry) {
        pendingRetry = false;
        void run();
      }
    }
  }

  function requestSync(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void run();
    }, DEBOUNCE_MS);
  }

  function start(): void {
    if (pollTimer === null) {
      pollTimer = setInterval(() => {
        const { status } = useSyncStore.getState();
        if (status === "syncing") {
          return;
        }

        void run();
      }, POLL_INTERVAL_MS);
    }

    if (typeof window !== "undefined" && removeOnlineListeners === null) {
      const handleOnline = () => {
        useSyncStore.getState().setOnline(true);
        void run();
      };

      const handleOffline = () => {
        useSyncStore.getState().setOnline(false);
      };

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      removeOnlineListeners = () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
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

    if (removeOnlineListeners) {
      removeOnlineListeners();
      removeOnlineListeners = null;
    }
  }

  return { requestSync, start, stop };
}

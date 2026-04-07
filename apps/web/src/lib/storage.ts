export type SyncStatus = "idle" | "syncing" | "unsynced";

const DRAFT_STORAGE_PREFIX = "markean:draft:";
const SYNC_STATUS_STORAGE_KEY = "markean:sync-status";
const STATE_EVENT = "markean:web-state-changed";

function isBrowser() {
  return typeof window !== "undefined";
}

function getStorage() {
  if (!isBrowser()) {
    return undefined;
  }

  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    return undefined;
  }

  return storage;
}

function notifyStateChange() {
  if (!isBrowser()) {
    return;
  }

  window.dispatchEvent(new Event(STATE_EVENT));
}

export function getDraft(noteId: string, fallback = "") {
  const storage = getStorage();
  if (!storage) {
    return fallback;
  }

  return storage.getItem(`${DRAFT_STORAGE_PREFIX}${noteId}`) ?? fallback;
}

export function saveDraft(noteId: string, value: string) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(`${DRAFT_STORAGE_PREFIX}${noteId}`, value);
  setSyncStatus("unsynced");
}

export function getSyncStatus(): SyncStatus {
  const storage = getStorage();
  if (!storage) {
    return "idle";
  }

  const stored = storage.getItem(SYNC_STATUS_STORAGE_KEY);
  return stored === "syncing" || stored === "unsynced" ? stored : "idle";
}

export function setSyncStatus(status: SyncStatus) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(SYNC_STATUS_STORAGE_KEY, status);
  notifyStateChange();
}

export function subscribeToStorageState(listener: () => void) {
  if (!isBrowser()) {
    return () => {};
  }

  const handleStateChange = () => listener();
  window.addEventListener(STATE_EVENT, handleStateChange);
  window.addEventListener("storage", handleStateChange);

  return () => {
    window.removeEventListener(STATE_EVENT, handleStateChange);
    window.removeEventListener("storage", handleStateChange);
  };
}

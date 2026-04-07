export type SyncStatus = "idle" | "syncing" | "unsynced";
export type WorkspaceFolder = {
  id: string;
  name: string;
};
export type WorkspaceNote = {
  id: string;
  folderId: string;
  title: string;
  body: string;
  updatedAt: string;
};
export type WorkspaceSnapshot = {
  folders: WorkspaceFolder[];
  notes: WorkspaceNote[];
  activeFolderId: string;
  activeNoteId: string;
};

const DRAFT_STORAGE_PREFIX = "markean:draft:";
const SYNC_STATUS_STORAGE_KEY = "markean:sync-status";
const WORKSPACE_STORAGE_KEY = "markean:workspace";
const STATE_EVENT = "markean:web-state-changed";

function isBrowser() {
  return typeof window !== "undefined";
}

function isStorageLike(storage: unknown): storage is Storage {
  return (
    typeof storage === "object" &&
    storage !== null &&
    typeof (storage as Storage).getItem === "function" &&
    typeof (storage as Storage).setItem === "function"
  );
}

function getStorage(): Storage | undefined {
  if (!isBrowser()) {
    return undefined;
  }

  const storage = window.localStorage;
  if (!isStorageLike(storage)) {
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

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const snapshot = value as WorkspaceSnapshot;
  if (!Array.isArray(snapshot.folders) || !Array.isArray(snapshot.notes)) {
    return false;
  }

  return (
    typeof snapshot.activeFolderId === "string" &&
    typeof snapshot.activeNoteId === "string" &&
    snapshot.folders.every((folder) => typeof folder.id === "string" && typeof folder.name === "string") &&
    snapshot.notes.every(
      (note) =>
        typeof note.id === "string" &&
        typeof note.folderId === "string" &&
        typeof note.title === "string" &&
        typeof note.body === "string" &&
        (!("updatedAt" in note) || typeof note.updatedAt === "string"),
    )
  );
}

export function getWorkspaceSnapshot() {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const stored = storage.getItem(WORKSPACE_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    return isWorkspaceSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
  notifyStateChange();
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

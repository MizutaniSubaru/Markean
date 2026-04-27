import { create } from "zustand";
import type { FolderRecord } from "@markean/domain";

type FoldersState = {
  folders: FolderRecord[];
  loadFolders: (folders: FolderRecord[]) => void;
  addFolder: (name: string) => FolderRecord;
  deleteFolder: (id: string) => void;
};

function createId() {
  return `folder_${crypto.randomUUID()}`;
}

export const useFoldersStore = create<FoldersState>((set, get) => ({
  folders: [],

  loadFolders: (folders) => set({ folders: [...folders] }),

  addFolder: (name) => {
    const folder: FolderRecord = {
      id: createId(),
      name,
      sortOrder: get().folders.length,
      currentRevision: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    set((state) => ({ folders: [...state.folders, folder] }));
    return folder;
  },

  deleteFolder: (id) =>
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, deletedAt: new Date().toISOString() } : f,
      ),
    })),
}));

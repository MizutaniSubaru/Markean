type FolderRecord = {
  id: string;
  name: string;
  currentRevision?: number;
  updatedAt?: string;
  deletedAt?: string | null;
};

type NoteRecord = {
  id: string;
  folderId: string;
  title: string;
  bodyMd: string;
  bodyPlain: string;
  currentRevision?: number;
  updatedAt?: string;
  deletedAt?: string | null;
};

type ConflictCopyRecord = {
  id: string;
  title: string;
  bodyMd: string;
};

type BootstrapPayload = {
  folders?: FolderRecord[];
  notes?: NoteRecord[];
  syncCursor?: number;
};

type BootstrapApi = {
  bootstrap: () => Promise<BootstrapPayload>;
};

export function createAppStore({ api }: { api: BootstrapApi }) {
  const state = {
    folders: [] as FolderRecord[],
    notes: [] as NoteRecord[],
    conflictedCopies: [] as ConflictCopyRecord[],
    syncCursor: 0,
  };

  return {
    getState() {
      return state;
    },
    applySyncResult(result: { conflictedCopies?: ConflictCopyRecord[] }) {
      state.conflictedCopies = result.conflictedCopies ?? [];
    },
    async bootstrap() {
      const payload = await api.bootstrap();
      state.folders = payload.folders ?? [];
      state.notes = payload.notes ?? [];
      state.syncCursor = payload.syncCursor ?? 0;
    },
  };
}

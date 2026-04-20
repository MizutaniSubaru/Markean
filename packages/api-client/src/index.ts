export type BootstrapResponse = {
  user?: { id: string; email?: string };
  folders: unknown[];
  notes: unknown[];
  syncCursor: number;
};

export type SyncChange = {
  clientChangeId: string;
  entityType: "note" | "folder";
  entityId: string;
  operation: "create" | "update" | "delete";
  baseRevision: number;
  payload: Record<string, unknown> | null;
};

export type SyncPushResponse = {
  accepted: Array<{ acceptedRevision: number; cursor: number }>;
  conflicts?: Array<{
    entityType: string;
    entityId: string;
    serverRevision: number;
  }>;
  cursor?: number;
};

export type SyncEventWithEntity = {
  cursor: number;
  entityType: string;
  entityId: string;
  operation: string;
  revisionNumber: number;
  sourceDeviceId: string;
  entity: Record<string, unknown> | null;
};

export type SyncPullResponse = {
  nextCursor: number;
  events: SyncEventWithEntity[];
};

export type TrashResponse = Array<{
  id: string;
  folderId: string;
  title: string;
  bodyMd: string;
  bodyPlain: string;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}>;

export function createApiClient(baseUrl = "") {
  const prefix = baseUrl.replace(/\/$/, "");

  return {
    async bootstrap(): Promise<BootstrapResponse> {
      const response = await fetch(`${prefix}/api/bootstrap`, {
        credentials: "include",
      });
      return response.json();
    },

    async syncPush(input: {
      deviceId: string;
      changes: SyncChange[];
    }): Promise<SyncPushResponse> {
      const response = await fetch(`${prefix}/api/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      return response.json();
    },

    async syncPull(cursor: number): Promise<SyncPullResponse> {
      const response = await fetch(`${prefix}/api/sync/pull?cursor=${cursor}`, {
        credentials: "include",
      });
      return response.json();
    },

    async restoreNote(noteId: string): Promise<{ id: string; revision: number }> {
      const response = await fetch(`${prefix}/api/notes/${noteId}/restore`, {
        method: "POST",
        credentials: "include",
      });
      return response.json();
    },

    async listTrash(): Promise<TrashResponse> {
      const response = await fetch(`${prefix}/api/notes/trash`, {
        credentials: "include",
      });
      return response.json();
    },
  };
}

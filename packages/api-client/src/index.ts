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

export type AuthProvider = "google" | "apple";

export type MagicLinkRequest = {
  email: string;
  redirectTarget?: string;
};

export class ApiClientHttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiClientHttpError";
    this.status = status;
    this.body = body;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = await parseJson(response);
  const responseLike = response as Response & { ok?: boolean; status?: number };
  const ok = typeof responseLike.ok === "boolean" ? responseLike.ok : true;

  if (!ok) {
    throw new ApiClientHttpError(responseLike.status ?? 500, body);
  }

  return body as T;
}

export function createApiClient(baseUrl = "") {
  const prefix = baseUrl.replace(/\/$/, "");

  return {
    async bootstrap(): Promise<BootstrapResponse> {
      const response = await fetch(`${prefix}/api/bootstrap`, {
        credentials: "include",
      });
      return parseJsonOrThrow<BootstrapResponse>(response);
    },

    authStartUrl(provider: AuthProvider, input: { redirectTarget?: string } = {}): string {
      const params = new URLSearchParams({
        clientType: "web",
        redirectTarget: input.redirectTarget ?? "/",
      });

      return `${prefix}/api/auth/${provider}/start?${params.toString()}`;
    },

    async requestMagicLink(input: MagicLinkRequest): Promise<{ ok: true }> {
      const response = await fetch(`${prefix}/api/auth/email/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: input.email,
          clientType: "web",
          redirectTarget: input.redirectTarget ?? "/",
        }),
      });
      return parseJsonOrThrow<{ ok: true }>(response);
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

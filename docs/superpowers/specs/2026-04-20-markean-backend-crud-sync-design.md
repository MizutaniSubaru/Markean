# Markean Backend CRUD + Sync System Design Spec

Date: 2026-04-20

## Overview

Complete the Markean backend by implementing full CRUD for folders and notes, extending the sync system to support all entity types and operations, adding session-based auth middleware, and integrating the frontend sync pipeline. The existing auth system (Google OAuth, Apple Sign-In, Magic Link) merged from `codex/markean-backend-auth-spec` is preserved unchanged.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **API Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Sync Coordination**: Cloudflare Durable Objects (`SyncCoordinator`)
- **Frontend Local Storage**: Dexie (IndexedDB wrapper)
- **Scheduled Tasks**: Cloudflare Cron Triggers
- **Auth**: Session cookie (dev-session + OAuth/Magic Link already implemented)

## Current State & Problems

| Module | Current State | Problem |
|--------|--------------|---------|
| `routes/folders.ts` | Empty stub — GET returns `[]`, POST echoes body | No CRUD |
| `routes/notes.ts` | Empty stub — same | No CRUD |
| `routes/sync.ts` | Hardcoded `DEV_USER_ID = "user_dev"` | No auth |
| `SyncCoordinator` | Only `entityType: "note"` + `operation: "update"` | Missing folder sync, create/delete ops |
| `repos/folders.ts` | Only `listFoldersByUserId` | Missing create/update/delete |
| `repos/notes.ts` | Only `listNotesByUserId` | Missing create/update/delete |
| `PendingChange` | Includes `"move"` operation | Should be removed (note folder change = update) |
| `api-client` | Only `bootstrap()` | Missing sync push/pull |
| `storage-web/db.ts` | No `folders` table | Folders can't be stored offline |
| `FolderRecord` | Missing `sortOrder` field | Sort order not persisted |
| `bootstrap.ts` route | Returns all data including soft-deleted | Should filter deleted |

## Auth Middleware

Extract a reusable auth middleware from the inline logic in `bootstrap.ts`:

```ts
// apps/api/src/middleware/auth.ts
import { createMiddleware } from "hono/factory";
import { getSessionIdFromCookie, getUserForSessionCookieValue } from "../lib/repos/sessions";
import { getDb } from "../lib/db";
import type { Env } from "../env";

export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: { userId: string; userEmail: string };
}>(async (c, next) => {
  const cookieValue = getSessionIdFromCookie(c.req.header("cookie"));
  if (!cookieValue) return c.json({ error: "Unauthorized" }, 401);

  const user = await getUserForSessionCookieValue(getDb(c.env), cookieValue);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  c.set("userId", user.id);
  c.set("userEmail", user.email);
  await next();
});
```

Applied to:
- `routes/folders.ts` — all routes
- `routes/notes.ts` — all routes
- `routes/sync.ts` — all routes
- `routes/bootstrap.ts` — replace inline auth logic

Not applied to:
- `routes/auth.ts` — is the auth entry point itself
- `routes/dev-session.ts` — creates sessions
- `routes/health.ts` — public

## Database Migration

### `0003_add_revision_to_folders.sql`

```sql
ALTER TABLE folders ADD COLUMN current_revision INTEGER NOT NULL DEFAULT 1;
```

All other required columns already exist in the schema (`deleted_at`, `sort_order` on folders; `deleted_at`, `current_revision` on notes).

## SyncCoordinator Extension

### Input Types

```ts
export type SyncChangeInput = {
  userId: string;
  deviceId: string;
  clientChangeId: string;
  entityType: "note" | "folder";
  entityId: string;
  operation: "create" | "update" | "delete";
  baseRevision: number;
  payload: NotePayload | FolderPayload | null; // null for delete
};

type NotePayload = {
  folderId: string;
  title: string;
  bodyMd: string;
};

type FolderPayload = {
  name: string;
  sortOrder: number;
};
```

### Operation Dispatch

| entityType | operation | D1 Action |
|------------|-----------|-----------|
| `note` | `create` | INSERT into notes |
| `note` | `update` | UPDATE notes (title, bodyMd, folderId) |
| `note` | `delete` | UPDATE notes SET deleted_at = now (soft delete) |
| `folder` | `create` | INSERT into folders |
| `folder` | `update` | UPDATE folders (name, sort_order) |
| `folder` | `delete` | UPDATE folders SET deleted_at = now + cascade soft-delete all notes in folder |

### Conflict Detection

In `routes/sync.ts`, before delegating to SyncCoordinator:

- `create` (baseRevision = 0): no conflict check
- `delete`: no conflict check (last-delete-wins)
- `update`: query `current_revision` from the corresponding table (`notes` or `folders`). If `server_revision > baseRevision`, return conflict.

### Note on Folder Deletion

When a folder is soft-deleted, all notes in that folder are also soft-deleted in the same SyncCoordinator transaction. A sync_event is written for the folder deletion; the cascaded note deletions also produce sync_events so other devices can pick them up.

## REST Routes

Write operations go through sync push. REST routes handle reads and the special restore operation.

### `routes/folders.ts`

```
GET /api/folders — list active folders (deleted_at IS NULL) for current user
```

### `routes/notes.ts`

```
GET /api/notes — list active notes (deleted_at IS NULL) for current user
GET /api/notes/trash — list soft-deleted notes for current user
POST /api/notes/:id/restore — restore a soft-deleted note (set deleted_at = NULL, bump revision)
```

### Restore Operation

`restore` is the only write operation that doesn't go through sync — it's a server-side feature (trash recovery). It directly updates D1 and writes a sync_event so other devices learn about the restore via pull.

### `routes/bootstrap.ts`

Update to only return active (non-deleted) folders and notes. Add `requireAuth` middleware, removing inline auth logic.

## Repos Layer

### `repos/folders.ts`

| Function | Description |
|----------|-------------|
| `listFoldersByUserId` | Existing — returns all folders |
| `listActiveFoldersByUserId` | New — filter `deleted_at IS NULL`, order by `sort_order` |

### `repos/notes.ts`

| Function | Description |
|----------|-------------|
| `listNotesByUserId` | Existing — returns all notes |
| `listActiveNotesByUserId` | New — filter `deleted_at IS NULL`, order by `updated_at DESC` |
| `listDeletedNotesByUserId` | New — filter `deleted_at IS NOT NULL`, order by `deleted_at DESC` |
| `restoreNote` | New — set `deleted_at = NULL`, bump `current_revision` |
| `getLatestSyncCursorForUser` | Existing — unchanged |

### `repos/sync-events.ts`

Extend `SyncEventRow` to include `entityType` and `operation`:

```ts
type SyncEventRow = {
  cursor: number;
  entityType: string;
  entityId: string;
  operation: string;
  revisionNumber: number;
};
```

## Sync Pull with Entity Data

Pull response includes full entity data via JOIN, so the client gets everything in one request:

```ts
// Pull response shape
{
  nextCursor: number;
  events: Array<{
    cursor: number;
    entityType: "note" | "folder";
    entityId: string;
    operation: "create" | "update" | "delete";
    revisionNumber: number;
    entity: NoteData | FolderData | null;  // null if permanently deleted
  }>;
}
```

For `create` and `update` events, JOIN the corresponding table to include the full entity. For `delete` events, `entity` is null (the client just needs to know to mark it deleted locally).

Implementation: use two queries (one JOIN for note events, one JOIN for folder events) then merge and sort by cursor.

## Cron Trigger — Trash Cleanup

### Schedule

Daily at 03:00 UTC via Cloudflare Cron Trigger.

### Logic

```ts
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const db = env.DB;
    await db.prepare(
      `DELETE FROM notes WHERE deleted_at IS NOT NULL
       AND deleted_at < datetime('now', '-30 days')`
    ).run();
    await db.prepare(
      `DELETE FROM folders WHERE deleted_at IS NOT NULL
       AND deleted_at < datetime('now', '-30 days')`
    ).run();
  },
};
```

### wrangler.jsonc

```jsonc
"triggers": {
  "crons": ["0 3 * * *"]
}
```

## Shared Packages

### `@markean/domain`

**`pending-change.ts`**: Remove `"move"` from operation union:

```ts
operation: "create" | "update" | "delete";
```

Moving a note to another folder = `operation: "update"` with a changed `folderId`.

**`folder.ts`**: Add `sortOrder` to `FolderRecord`:

```ts
export type FolderRecord = {
  id: string;
  name: string;
  sortOrder: number;      // added
  currentRevision: number;
  updatedAt: string;
  deletedAt: string | null;
};
```

### `@markean/api-client`

Add sync push/pull and restore methods:

```ts
export function createApiClient(baseUrl = "") {
  const prefix = baseUrl.replace(/\/$/, "");

  return {
    async bootstrap(): Promise<BootstrapResponse> { ... },  // existing

    async syncPush(input: {
      deviceId: string;
      changes: SyncChange[];
    }): Promise<SyncPushResponse> {
      const res = await fetch(`${prefix}/api/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      return res.json();
    },

    async syncPull(cursor: number): Promise<SyncPullResponse> {
      const res = await fetch(`${prefix}/api/sync/pull?cursor=${cursor}`, {
        credentials: "include",
      });
      return res.json();
    },

    async restoreNote(noteId: string): Promise<void> {
      await fetch(`${prefix}/api/notes/${noteId}/restore`, {
        method: "POST",
        credentials: "include",
      });
    },

    async listTrash(): Promise<TrashResponse> {
      const res = await fetch(`${prefix}/api/notes/trash`, {
        credentials: "include",
      });
      return res.json();
    },
  };
}
```

### `@markean/storage-web`

Upgrade Dexie schema to v2, add `folders` table:

```ts
this.version(2).stores({
  notes: "id, folderId, updatedAt",
  folders: "id, sortOrder",
  pendingChanges: "clientChangeId, entityId, operation",
  syncState: "key",
});
```

### `@markean/sync-core`

Rewrite `push-pull.ts` to support the full sync cycle:

| Function | Description |
|----------|-------------|
| `queueChange(db, change)` | Generic change enqueue — write to IndexedDB pendingChanges (replaces `queueNoteUpdate`) |
| `pushChanges(db, apiClient)` | Read all pendingChanges, call `syncPush`, clear accepted changes |
| `pullChanges(db, apiClient)` | Call `syncPull` with stored cursor, apply entity data to local IndexedDB, update cursor |
| `runSyncCycle(db, apiClient)` | Push then pull — called by `startBackgroundSync` |

Remove `queueNoteUpdate` and `reconcilePushResult` (replaced by generic functions).

## Frontend Sync Integration

### Device ID

Generate once per browser, stored in IndexedDB `syncState` table:

```ts
const deviceId = `dev_${crypto.randomUUID()}`;
await db.syncState.put({ key: "deviceId", value: deviceId });
```

### Sync Cycle

`apps/web/src/lib/sync.ts` keeps its existing `startBackgroundSync` architecture (15-second interval + online event). The `runOnce` callback becomes:

```ts
startBackgroundSync(async () => {
  setSyncStatus("syncing");
  try {
    await runSyncCycle(db, apiClient);
    setSyncStatus("idle");
  } catch {
    setSyncStatus("unsynced");
  }
});
```

### Edit Flow

1. User edits → `onChange` callback
2. Update App state + `saveWorkspaceSnapshot()` (immediate UI response)
3. `queueChange(db, { entityType: "note", operation: "update", ... })` (write to IndexedDB)
4. Next sync cycle auto pushes + pulls

Create/delete/move folders and notes follow the same pattern with different `entityType` and `operation`.

### Pull Application

Pull events include full entity data. The client applies them directly:
- `create` / `update` → upsert entity into local IndexedDB
- `delete` → set `deletedAt` on local entity
- Skip events from own `deviceId` (already applied locally)
- Update stored sync cursor after processing

## File Structure Summary

```
apps/api/
├── migrations/
│   └── 0003_add_revision_to_folders.sql    # NEW
├── src/
│   ├── index.ts                             # MODIFY: add scheduled export, cron handler
│   ├── middleware/
│   │   └── auth.ts                          # NEW: requireAuth middleware
│   ├── durable/
│   │   └── SyncCoordinator.ts               # MODIFY: extend for folder + create/delete
│   ├── routes/
│   │   ├── folders.ts                       # REWRITE: GET with auth
│   │   ├── notes.ts                         # REWRITE: GET + trash + restore with auth
│   │   ├── sync.ts                          # MODIFY: replace DEV_USER_ID, extend conflict detection
│   │   └── bootstrap.ts                     # MODIFY: use requireAuth, filter deleted
│   └── lib/repos/
│       ├── folders.ts                       # MODIFY: add listActiveFoldersByUserId
│       ├── notes.ts                         # MODIFY: add active/deleted/restore queries
│       └── sync-events.ts                   # MODIFY: add entityType/operation to row type, JOIN entity data
├── wrangler.jsonc                           # MODIFY: add cron trigger

packages/
├── domain/src/
│   ├── pending-change.ts                    # MODIFY: remove "move"
│   └── folder.ts                            # MODIFY: add sortOrder
├── api-client/src/
│   └── index.ts                             # MODIFY: add syncPush/syncPull/restoreNote/listTrash
├── storage-web/src/
│   └── db.ts                                # MODIFY: add folders table, bump to v2
└── sync-core/src/
    └── push-pull.ts                         # REWRITE: queueChange/pushChanges/pullChanges/runSyncCycle
```

## Out of Scope

- Dark mode
- Multi-page routing
- Folder nesting / sub-folders
- Real-time collaboration (WebSocket)
- Export to file (R2 binding exists but unused)
- Conflict resolution UI (server-wins for now, conflicted copies saved locally)

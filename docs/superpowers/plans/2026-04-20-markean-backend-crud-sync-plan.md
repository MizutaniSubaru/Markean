# Markean Backend CRUD + Sync System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Markean backend with full CRUD for folders and notes, extend the sync system for all entity types/operations, add session-based auth middleware, trash cleanup via Cron Trigger, and wire up the frontend sync pipeline.

**Architecture:** All write operations flow through the sync system (push → SyncCoordinator → D1 + sync_events). REST routes are read-only except for trash restore. Auth middleware extracts userId from session cookie. Cron Trigger purges 30-day-old soft-deleted records daily.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), Durable Objects, Dexie (IndexedDB), Cron Triggers

---

## File Structure

```
MODIFY:
  packages/domain/src/pending-change.ts      — remove "move" from operation union
  packages/domain/src/folder.ts              — add sortOrder to FolderRecord
  packages/domain/src/index.ts               — clean up duplicate re-exports
  packages/api-client/src/index.ts           — add syncPush/syncPull/restoreNote/listTrash + types
  packages/storage-web/src/db.ts             — add folders table, bump Dexie schema to v2
  packages/sync-core/src/push-pull.ts        — rewrite: queueChange/pushChanges/pullChanges/runSyncCycle
  packages/sync-core/src/index.ts            — update exports
  apps/api/src/lib/repos/folders.ts          — add listActiveFoldersByUserId
  apps/api/src/lib/repos/notes.ts            — add listActiveNotesByUserId, listDeletedNotesByUserId, restoreNote
  apps/api/src/lib/repos/sync-events.ts      — add entityType/operation fields, add listSyncEventsWithEntities
  apps/api/src/durable/SyncCoordinator.ts    — extend for folder + create/delete operations
  apps/api/src/routes/folders.ts             — rewrite: GET with auth
  apps/api/src/routes/notes.ts               — rewrite: GET + trash + restore with auth
  apps/api/src/routes/sync.ts                — replace DEV_USER_ID with auth, extend conflict detection
  apps/api/src/routes/bootstrap.ts           — use requireAuth, filter deleted
  apps/api/src/index.ts                      — add scheduled export for cron
  apps/api/wrangler.jsonc                    — add cron trigger config

CREATE:
  apps/api/migrations/0003_add_revision_to_folders.sql  — ALTER TABLE folders ADD current_revision
  apps/api/src/middleware/auth.ts                        — requireAuth middleware

TEST:
  apps/api/test/auth-middleware.test.ts       — auth middleware tests
  apps/api/test/folders.test.ts               — folder route tests
  apps/api/test/notes.test.ts                 — notes route tests (including trash/restore)
  apps/api/test/sync.test.ts                  — update existing sync tests for auth + new operations
  apps/api/test/bootstrap.test.ts             — update existing bootstrap tests
```

---

### Task 1: Database Migration — Add current_revision to folders

**Files:**
- Create: `apps/api/migrations/0003_add_revision_to_folders.sql`

- [ ] **Step 1: Create migration file**

```sql
-- apps/api/migrations/0003_add_revision_to_folders.sql
ALTER TABLE folders ADD COLUMN current_revision INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/migrations/0003_add_revision_to_folders.sql
git commit -m "feat: add current_revision column to folders table"
```

---

### Task 2: Domain Package — Clean up types

**Files:**
- Modify: `packages/domain/src/pending-change.ts`
- Modify: `packages/domain/src/folder.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Remove "move" from PendingChange operation union**

In `packages/domain/src/pending-change.ts`, change:

```ts
operation: "create" | "update" | "delete" | "move";
```

to:

```ts
operation: "create" | "update" | "delete";
```

- [ ] **Step 2: Add sortOrder to FolderRecord**

In `packages/domain/src/folder.ts`, replace the entire file with:

```ts
export type FolderRecord = {
  id: string;
  name: string;
  sortOrder: number;
  currentRevision: number;
  updatedAt: string;
  deletedAt: string | null;
};

export function createFolderRecord(input: { id: string; name: string; sortOrder: number }): FolderRecord {
  return {
    id: input.id,
    name: input.name,
    sortOrder: input.sortOrder,
    currentRevision: 1,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}
```

- [ ] **Step 3: Clean up duplicate re-exports in index.ts**

In `packages/domain/src/index.ts`, replace the entire file with:

```ts
export * from "./folder";
export * from "./note";
export * from "./pending-change";

export const workspaceName = "markean";
```

- [ ] **Step 4: Run typecheck to verify**

Run: `cd packages/domain && pnpm typecheck`
Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/pending-change.ts packages/domain/src/folder.ts packages/domain/src/index.ts
git commit -m "feat: clean up domain types — remove move op, add sortOrder to FolderRecord"
```

---

### Task 3: Auth Middleware

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Test: `apps/api/test/auth-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/auth-middleware.test.ts`:

```ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    current_revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    current_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    client_change_id TEXT NOT NULL,
    source_device_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

const baseEnv = env as typeof env & { DB: D1Database; ALLOW_DEV_SESSION: string };

describe("auth middleware", () => {
  beforeAll(async () => {
    for (const statement of migrationStatements) {
      await baseEnv.DB.prepare(statement).run();
    }
  });

  it("rejects requests without session cookie on protected routes", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/folders"),
      baseEnv,
    );
    expect(response.status).toBe(401);
  });

  it("rejects requests with invalid session cookie", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/folders", {
        headers: { cookie: "markean_session=invalid_session_id" },
      }),
      baseEnv,
    );
    expect(response.status).toBe(401);
  });

  it("allows requests with valid session cookie", async () => {
    const devEnv = { ...baseEnv, ALLOW_DEV_SESSION: "true" };
    const signIn = await worker.fetch(
      new Request("https://example.com/api/dev/session", { method: "POST" }),
      devEnv,
    );
    const cookie = signIn.headers.get("set-cookie")!;

    const response = await worker.fetch(
      new Request("https://example.com/api/folders", {
        headers: { cookie },
      }),
      devEnv,
    );
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- --run test/auth-middleware.test.ts`
Expected: FAIL (routes don't have auth yet, GET /api/folders returns 200 without cookie)

- [ ] **Step 3: Create auth middleware**

Create `apps/api/src/middleware/auth.ts`:

```ts
import { createMiddleware } from "hono/factory";
import { getDb } from "../lib/db";
import { getSessionIdFromCookie, getUserForSessionCookieValue } from "../lib/repos/sessions";
import type { Env } from "../env";

type AuthVariables = {
  userId: string;
  userEmail: string;
};

export type AuthEnv = {
  Bindings: Env;
  Variables: AuthVariables;
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const cookieValue = getSessionIdFromCookie(c.req.header("cookie"));
  if (!cookieValue) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const user = await getUserForSessionCookieValue(getDb(c.env), cookieValue);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", user.id);
  c.set("userEmail", user.email);
  await next();
});
```

- [ ] **Step 4: Apply auth middleware to folders route**

Replace `apps/api/src/routes/folders.ts` with:

```ts
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { listActiveFoldersByUserId } from "../lib/repos/folders";

export const folderRoutes = new Hono<AuthEnv>()
  .use("/api/folders/*", requireAuth)
  .use("/api/folders", requireAuth)
  .get("/api/folders", async (c) => {
    const folders = await listActiveFoldersByUserId(getDb(c.env), c.get("userId"));
    return c.json(folders);
  });
```

- [ ] **Step 5: Add listActiveFoldersByUserId to repos**

In `apps/api/src/lib/repos/folders.ts`, add after the existing `listFoldersByUserId` function:

```ts
export const listActiveFoldersByUserId = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare(
      `SELECT
         id,
         name,
         sort_order AS sortOrder,
         current_revision AS currentRevision,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM folders
       WHERE user_id = ?
         AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(userId)
    .all<FolderRow>();

  return result.results;
};
```

Also update the `FolderRow` type at the top to include `currentRevision`:

```ts
type FolderRow = {
  id: string;
  name: string;
  sortOrder: number;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && pnpm test -- --run test/auth-middleware.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/routes/folders.ts apps/api/src/lib/repos/folders.ts apps/api/test/auth-middleware.test.ts
git commit -m "feat: add requireAuth middleware, apply to folders route"
```

---

### Task 4: Notes Routes — GET + Trash + Restore

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/src/lib/repos/notes.ts`
- Test: `apps/api/test/notes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/notes.test.ts`:

```ts
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL,
    current_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, folder_id TEXT NOT NULL, title TEXT NOT NULL,
    body_md TEXT NOT NULL, body_plain TEXT NOT NULL, current_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL,
    revision_number INTEGER NOT NULL, client_change_id TEXT NOT NULL,
    source_device_id TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
];

const baseEnv = env as typeof env & { DB: D1Database; ALLOW_DEV_SESSION: string };

async function getDevCookie(): Promise<string> {
  const devEnv = { ...baseEnv, ALLOW_DEV_SESSION: "true" };
  const signIn = await worker.fetch(
    new Request("https://example.com/api/dev/session", { method: "POST" }),
    devEnv,
  );
  return signIn.headers.get("set-cookie")!;
}

describe("notes routes", () => {
  let cookie: string;

  beforeAll(async () => {
    for (const s of migrationStatements) {
      await baseEnv.DB.prepare(s).run();
    }
    cookie = await getDevCookie();
  });

  beforeEach(async () => {
    await baseEnv.DB.prepare("DELETE FROM notes").run();
    await baseEnv.DB.prepare("DELETE FROM sync_events").run();
  });

  it("GET /api/notes returns only active notes", async () => {
    const now = new Date().toISOString();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("n1", "user_dev", "f1", "Active", "body", "body", 1, now, now, null).run();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("n2", "user_dev", "f1", "Deleted", "body", "body", 1, now, now, now).run();

    const res = await worker.fetch(
      new Request("https://example.com/api/notes", { headers: { cookie } }),
      { ...baseEnv, ALLOW_DEV_SESSION: "true" },
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { id: string }[];
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("n1");
  });

  it("GET /api/notes/trash returns only deleted notes", async () => {
    const now = new Date().toISOString();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("n1", "user_dev", "f1", "Active", "body", "body", 1, now, now, null).run();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("n2", "user_dev", "f1", "Deleted", "body", "body", 1, now, now, now).run();

    const res = await worker.fetch(
      new Request("https://example.com/api/notes/trash", { headers: { cookie } }),
      { ...baseEnv, ALLOW_DEV_SESSION: "true" },
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { id: string }[];
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("n2");
  });

  it("POST /api/notes/:id/restore restores a deleted note", async () => {
    const now = new Date().toISOString();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("n1", "user_dev", "f1", "Deleted", "body", "body", 1, now, now, now).run();

    const devEnv = { ...baseEnv, ALLOW_DEV_SESSION: "true" };
    const res = await worker.fetch(
      new Request("https://example.com/api/notes/n1/restore", {
        method: "POST",
        headers: { cookie },
      }),
      devEnv,
    );

    expect(res.status).toBe(200);

    // Verify note is no longer in trash
    const note = await baseEnv.DB.prepare("SELECT deleted_at, current_revision FROM notes WHERE id = ?")
      .bind("n1").first<{ deleted_at: string | null; current_revision: number }>();
    expect(note!.deleted_at).toBeNull();
    expect(note!.current_revision).toBe(2);

    // Verify sync_event was created
    const event = await baseEnv.DB.prepare("SELECT * FROM sync_events WHERE entity_id = ?")
      .bind("n1").first();
    expect(event).not.toBeNull();
  });

  it("POST /api/notes/:id/restore returns 404 for non-existent note", async () => {
    const devEnv = { ...baseEnv, ALLOW_DEV_SESSION: "true" };
    const res = await worker.fetch(
      new Request("https://example.com/api/notes/nonexistent/restore", {
        method: "POST",
        headers: { cookie },
      }),
      devEnv,
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pnpm test -- --run test/notes.test.ts`
Expected: FAIL

- [ ] **Step 3: Add repo functions for notes**

In `apps/api/src/lib/repos/notes.ts`, add after existing functions:

```ts
export const listActiveNotesByUserId = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare(
      `SELECT
         id,
         folder_id AS folderId,
         title,
         body_md AS bodyMd,
         body_plain AS bodyPlain,
         current_revision AS currentRevision,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM notes
       WHERE user_id = ?
         AND deleted_at IS NULL
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .bind(userId)
    .all<NoteRow>();

  return result.results;
};

export const listDeletedNotesByUserId = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare(
      `SELECT
         id,
         folder_id AS folderId,
         title,
         body_md AS bodyMd,
         body_plain AS bodyPlain,
         current_revision AS currentRevision,
         created_at AS createdAt,
         updated_at AS updatedAt,
         deleted_at AS deletedAt
       FROM notes
       WHERE user_id = ?
         AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
    )
    .bind(userId)
    .all<NoteRow>();

  return result.results;
};

export const restoreNote = async (db: D1Database, userId: string, noteId: string) => {
  const note = await db
    .prepare("SELECT id, current_revision FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
    .bind(noteId, userId)
    .first<{ id: string; current_revision: number }>();

  if (!note) return null;

  const now = new Date().toISOString();
  const newRevision = note.current_revision + 1;

  await db.batch([
    db.prepare("UPDATE notes SET deleted_at = NULL, current_revision = ?, updated_at = ? WHERE id = ?")
      .bind(newRevision, now, noteId),
    db.prepare(
      `INSERT INTO sync_events (id, user_id, entity_type, entity_id, operation, revision_number, client_change_id, source_device_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(`evt_${crypto.randomUUID()}`, userId, "note", noteId, "update", newRevision, `restore_${noteId}`, "server", now),
  ]);

  return { id: noteId, revision: newRevision };
};
```

- [ ] **Step 4: Rewrite notes route**

Replace `apps/api/src/routes/notes.ts` with:

```ts
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { listActiveNotesByUserId, listDeletedNotesByUserId, restoreNote } from "../lib/repos/notes";

export const noteRoutes = new Hono<AuthEnv>()
  .use("/api/notes/*", requireAuth)
  .use("/api/notes", requireAuth)
  .get("/api/notes", async (c) => {
    const notes = await listActiveNotesByUserId(getDb(c.env), c.get("userId"));
    return c.json(notes);
  })
  .get("/api/notes/trash", async (c) => {
    const notes = await listDeletedNotesByUserId(getDb(c.env), c.get("userId"));
    return c.json(notes);
  })
  .post("/api/notes/:id/restore", async (c) => {
    const noteId = c.req.param("id");
    const result = await restoreNote(getDb(c.env), c.get("userId"), noteId);
    if (!result) {
      return c.json({ error: "Note not found or not deleted" }, 404);
    }
    return c.json(result);
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pnpm test -- --run test/notes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/notes.ts apps/api/src/lib/repos/notes.ts apps/api/test/notes.test.ts
git commit -m "feat: implement notes routes — GET active, GET trash, POST restore"
```

---

### Task 5: Update Bootstrap Route — Use Auth Middleware + Filter Deleted

**Files:**
- Modify: `apps/api/src/routes/bootstrap.ts`
- Modify: `apps/api/test/bootstrap.test.ts`

- [ ] **Step 1: Rewrite bootstrap.ts to use requireAuth and filter deleted**

Replace `apps/api/src/routes/bootstrap.ts` with:

```ts
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { listActiveFoldersByUserId } from "../lib/repos/folders";
import { listActiveNotesByUserId, getLatestSyncCursorForUser } from "../lib/repos/notes";

export const bootstrapRoutes = new Hono<AuthEnv>()
  .use("/api/bootstrap", requireAuth)
  .get("/api/bootstrap", async (c) => {
    const db = getDb(c.env);
    const userId = c.get("userId");

    const [folders, notes, syncCursor] = await Promise.all([
      listActiveFoldersByUserId(db, userId),
      listActiveNotesByUserId(db, userId),
      getLatestSyncCursorForUser(db, userId),
    ]);

    return c.json({
      user: { id: userId, email: c.get("userEmail") },
      folders,
      notes,
      syncCursor,
    });
  });
```

- [ ] **Step 2: Update bootstrap test to include current_revision in migration**

In `apps/api/test/bootstrap.test.ts`, update the folders migration statement to include `current_revision`:

Change:
```ts
  `CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
```

To:
```ts
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    current_revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
```

Also add `IF NOT EXISTS` to all other `CREATE TABLE` statements in this file to avoid conflicts when tests run in the same D1 instance.

- [ ] **Step 3: Run tests**

Run: `cd apps/api && pnpm test -- --run test/bootstrap.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/bootstrap.ts apps/api/test/bootstrap.test.ts
git commit -m "refactor: bootstrap route uses requireAuth middleware, filters deleted records"
```

---

### Task 6: Extend SyncCoordinator — Support All Entity Types + Operations

**Files:**
- Modify: `apps/api/src/durable/SyncCoordinator.ts`

- [ ] **Step 1: Rewrite SyncCoordinator.ts**

Replace `apps/api/src/durable/SyncCoordinator.ts` with:

```ts
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export type NotePayload = {
  folderId: string;
  title: string;
  bodyMd: string;
};

export type FolderPayload = {
  name: string;
  sortOrder: number;
};

export type SyncChangeInput = {
  userId: string;
  deviceId: string;
  clientChangeId: string;
  entityType: "note" | "folder";
  entityId: string;
  operation: "create" | "update" | "delete";
  baseRevision: number;
  payload: NotePayload | FolderPayload | null;
};

export type SyncChangeResult = {
  acceptedRevision: number;
  cursor: number;
};

type HandledChangeRow = SyncChangeResult & {
  client_change_id: string;
};

const toBodyPlain = (bodyMd: string) => bodyMd.replace(/\s+/g, " ").trim();

export class SyncCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS handled_changes (
          client_change_id TEXT PRIMARY KEY,
          accepted_revision INTEGER NOT NULL,
          cursor INTEGER NOT NULL
        )
      `);
    });
  }

  async applyChange(change: SyncChangeInput): Promise<SyncChangeResult> {
    const existing = this.ctx.storage.sql
      .exec<HandledChangeRow>(
        `SELECT
           client_change_id,
           accepted_revision AS acceptedRevision,
           cursor
         FROM handled_changes
         WHERE client_change_id = ?`,
        change.clientChangeId,
      )
      .toArray()[0];

    if (existing) {
      return {
        acceptedRevision: existing.acceptedRevision,
        cursor: existing.cursor,
      };
    }

    const now = new Date().toISOString();
    const acceptedRevision = change.baseRevision + 1;

    if (change.entityType === "note") {
      await this.applyNoteChange(change, acceptedRevision, now);
    } else {
      await this.applyFolderChange(change, acceptedRevision, now);
    }

    const eventRow = await this.env.DB.prepare(
      `INSERT INTO sync_events (
         id, user_id, entity_type, entity_id, operation,
         revision_number, client_change_id, source_device_id, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING cursor`,
    )
      .bind(
        `evt_${crypto.randomUUID()}`,
        change.userId,
        change.entityType,
        change.entityId,
        change.operation,
        acceptedRevision,
        change.clientChangeId,
        change.deviceId,
        now,
      )
      .first<{ cursor: number }>();

    const cursor = eventRow?.cursor ?? 0;

    // For folder deletion, also create sync_events for cascaded note deletions
    if (change.entityType === "folder" && change.operation === "delete") {
      await this.cascadeDeleteNotes(change.userId, change.entityId, change.deviceId, now);
    }

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO handled_changes (
         client_change_id, accepted_revision, cursor
       ) VALUES (?, ?, ?)`,
      change.clientChangeId,
      acceptedRevision,
      cursor,
    );

    return { acceptedRevision, cursor };
  }

  private async applyNoteChange(
    change: SyncChangeInput,
    acceptedRevision: number,
    now: string,
  ): Promise<void> {
    if (change.operation === "delete") {
      await this.env.DB.prepare(
        `UPDATE notes SET deleted_at = ?, current_revision = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      )
        .bind(now, acceptedRevision, now, change.entityId, change.userId)
        .run();
      return;
    }

    const payload = change.payload as NotePayload;
    const bodyPlain = toBodyPlain(payload.bodyMd);

    if (change.operation === "create") {
      await this.env.DB.prepare(
        `INSERT INTO notes (
           id, user_id, folder_id, title, body_md, body_plain,
           current_revision, created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
        .bind(
          change.entityId, change.userId, payload.folderId,
          payload.title, payload.bodyMd, bodyPlain,
          acceptedRevision, now, now,
        )
        .run();
      return;
    }

    // update
    await this.env.DB.prepare(
      `UPDATE notes SET
         folder_id = ?, title = ?, body_md = ?, body_plain = ?,
         current_revision = ?, updated_at = ?, deleted_at = NULL
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        payload.folderId, payload.title, payload.bodyMd, bodyPlain,
        acceptedRevision, now, change.entityId, change.userId,
      )
      .run();
  }

  private async applyFolderChange(
    change: SyncChangeInput,
    acceptedRevision: number,
    now: string,
  ): Promise<void> {
    if (change.operation === "delete") {
      await this.env.DB.prepare(
        `UPDATE folders SET deleted_at = ?, current_revision = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      )
        .bind(now, acceptedRevision, now, change.entityId, change.userId)
        .run();
      return;
    }

    const payload = change.payload as FolderPayload;

    if (change.operation === "create") {
      await this.env.DB.prepare(
        `INSERT INTO folders (
           id, user_id, name, sort_order, current_revision,
           created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
        .bind(
          change.entityId, change.userId, payload.name,
          payload.sortOrder, acceptedRevision, now, now,
        )
        .run();
      return;
    }

    // update
    await this.env.DB.prepare(
      `UPDATE folders SET
         name = ?, sort_order = ?, current_revision = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        payload.name, payload.sortOrder, acceptedRevision, now,
        change.entityId, change.userId,
      )
      .run();
  }

  private async cascadeDeleteNotes(
    userId: string,
    folderId: string,
    deviceId: string,
    now: string,
  ): Promise<void> {
    const notes = await this.env.DB.prepare(
      `SELECT id, current_revision FROM notes WHERE folder_id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
      .bind(folderId, userId)
      .all<{ id: string; current_revision: number }>();

    for (const note of notes.results) {
      const newRevision = note.current_revision + 1;
      await this.env.DB.prepare(
        `UPDATE notes SET deleted_at = ?, current_revision = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(now, newRevision, now, note.id)
        .run();

      await this.env.DB.prepare(
        `INSERT INTO sync_events (
           id, user_id, entity_type, entity_id, operation,
           revision_number, client_change_id, source_device_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          `evt_${crypto.randomUUID()}`, userId, "note", note.id, "delete",
          newRevision, `cascade_${folderId}_${note.id}`, deviceId, now,
        )
        .run();
    }
  }
}
```

- [ ] **Step 2: Run existing sync tests to check for regressions**

Run: `cd apps/api && pnpm test -- --run test/sync.test.ts`
Expected: PASS (existing update test should still work)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/durable/SyncCoordinator.ts
git commit -m "feat: extend SyncCoordinator for folder + create/delete operations"
```

---

### Task 7: Extend Sync Routes — Auth + Conflict Detection for All Entity Types

**Files:**
- Modify: `apps/api/src/routes/sync.ts`
- Modify: `apps/api/src/lib/repos/sync-events.ts`
- Modify: `apps/api/test/sync.test.ts`

- [ ] **Step 1: Update sync-events repo to include entityType and operation, add JOINed pull query**

Replace `apps/api/src/lib/repos/sync-events.ts` with:

```ts
type SyncEventRow = {
  cursor: number;
  entityType: string;
  entityId: string;
  operation: string;
  revisionNumber: number;
  sourceDeviceId: string;
};

type NoteEntityData = {
  id: string;
  folderId: string;
  title: string;
  bodyMd: string;
  bodyPlain: string;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type FolderEntityData = {
  id: string;
  name: string;
  sortOrder: number;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type SyncEventWithEntity = {
  cursor: number;
  entityType: string;
  entityId: string;
  operation: string;
  revisionNumber: number;
  sourceDeviceId: string;
  entity: NoteEntityData | FolderEntityData | null;
};

export const listSyncEventsByUserIdAfterCursor = async (
  db: D1Database,
  userId: string,
  cursor: number,
) => {
  const result = await db
    .prepare(
      `SELECT
         cursor,
         entity_type AS entityType,
         entity_id AS entityId,
         operation,
         revision_number AS revisionNumber,
         source_device_id AS sourceDeviceId
       FROM sync_events
       WHERE user_id = ?
         AND cursor > ?
       ORDER BY cursor ASC`,
    )
    .bind(userId, cursor)
    .all<SyncEventRow>();

  return result.results ?? [];
};

export const listSyncEventsWithEntities = async (
  db: D1Database,
  userId: string,
  cursor: number,
): Promise<SyncEventWithEntity[]> => {
  // Get note events with JOINed entity data
  const noteEvents = await db
    .prepare(
      `SELECT
         se.cursor,
         se.entity_type AS entityType,
         se.entity_id AS entityId,
         se.operation,
         se.revision_number AS revisionNumber,
         se.source_device_id AS sourceDeviceId,
         n.id AS n_id,
         n.folder_id AS n_folderId,
         n.title AS n_title,
         n.body_md AS n_bodyMd,
         n.body_plain AS n_bodyPlain,
         n.current_revision AS n_currentRevision,
         n.created_at AS n_createdAt,
         n.updated_at AS n_updatedAt,
         n.deleted_at AS n_deletedAt
       FROM sync_events se
       LEFT JOIN notes n ON se.entity_id = n.id
       WHERE se.user_id = ?
         AND se.cursor > ?
         AND se.entity_type = 'note'
       ORDER BY se.cursor ASC`,
    )
    .bind(userId, cursor)
    .all<SyncEventRow & {
      n_id: string | null; n_folderId: string; n_title: string;
      n_bodyMd: string; n_bodyPlain: string; n_currentRevision: number;
      n_createdAt: string; n_updatedAt: string; n_deletedAt: string | null;
    }>();

  // Get folder events with JOINed entity data
  const folderEvents = await db
    .prepare(
      `SELECT
         se.cursor,
         se.entity_type AS entityType,
         se.entity_id AS entityId,
         se.operation,
         se.revision_number AS revisionNumber,
         se.source_device_id AS sourceDeviceId,
         f.id AS f_id,
         f.name AS f_name,
         f.sort_order AS f_sortOrder,
         f.current_revision AS f_currentRevision,
         f.created_at AS f_createdAt,
         f.updated_at AS f_updatedAt,
         f.deleted_at AS f_deletedAt
       FROM sync_events se
       LEFT JOIN folders f ON se.entity_id = f.id
       WHERE se.user_id = ?
         AND se.cursor > ?
         AND se.entity_type = 'folder'
       ORDER BY se.cursor ASC`,
    )
    .bind(userId, cursor)
    .all<SyncEventRow & {
      f_id: string | null; f_name: string; f_sortOrder: number;
      f_currentRevision: number; f_createdAt: string; f_updatedAt: string;
      f_deletedAt: string | null;
    }>();

  const noteResults: SyncEventWithEntity[] = (noteEvents.results ?? []).map((row) => ({
    cursor: row.cursor,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    revisionNumber: row.revisionNumber,
    sourceDeviceId: row.sourceDeviceId,
    entity: row.n_id
      ? {
          id: row.n_id,
          folderId: row.n_folderId,
          title: row.n_title,
          bodyMd: row.n_bodyMd,
          bodyPlain: row.n_bodyPlain,
          currentRevision: row.n_currentRevision,
          createdAt: row.n_createdAt,
          updatedAt: row.n_updatedAt,
          deletedAt: row.n_deletedAt,
        }
      : null,
  }));

  const folderResults: SyncEventWithEntity[] = (folderEvents.results ?? []).map((row) => ({
    cursor: row.cursor,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    revisionNumber: row.revisionNumber,
    sourceDeviceId: row.sourceDeviceId,
    entity: row.f_id
      ? {
          id: row.f_id,
          name: row.f_name,
          sortOrder: row.f_sortOrder,
          currentRevision: row.f_currentRevision,
          createdAt: row.f_createdAt,
          updatedAt: row.f_updatedAt,
          deletedAt: row.f_deletedAt,
        }
      : null,
  }));

  return [...noteResults, ...folderResults].sort((a, b) => a.cursor - b.cursor);
};
```

- [ ] **Step 2: Rewrite sync routes with auth + extended conflict detection**

Replace `apps/api/src/routes/sync.ts` with:

```ts
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { listSyncEventsWithEntities } from "../lib/repos/sync-events";
import type { SyncChangeInput } from "../durable/SyncCoordinator";

type PushBody = {
  deviceId: string;
  changes: Array<Omit<SyncChangeInput, "userId" | "deviceId">>;
};

export const syncRoutes = new Hono<AuthEnv>()
  .use("/api/sync/*", requireAuth)
  .post("/api/sync/push", async (c) => {
    const body = (await c.req.json()) as PushBody;
    const userId = c.get("userId");
    const db = getDb(c.env);

    // Conflict detection for update operations
    const conflicts = [];
    for (const change of body.changes) {
      if (change.operation !== "update") continue;

      const table = change.entityType === "note" ? "notes" : "folders";
      const current = await db
        .prepare(`SELECT current_revision AS currentRevision FROM ${table} WHERE id = ? AND user_id = ?`)
        .bind(change.entityId, userId)
        .first<{ currentRevision: number }>();

      const serverRevision = current?.currentRevision ?? 0;
      if (serverRevision > change.baseRevision) {
        conflicts.push({
          entityType: change.entityType,
          entityId: change.entityId,
          serverRevision,
        });
      }
    }

    if (conflicts.length > 0) {
      return c.json({ accepted: [], conflicts }, 409);
    }

    const coordinator = c.env.SYNC_COORDINATOR.getByName(userId);
    const accepted = [];

    for (const change of body.changes) {
      accepted.push(
        await coordinator.applyChange({
          ...change,
          userId,
          deviceId: body.deviceId,
        }),
      );
    }

    return c.json({
      accepted,
      cursor: accepted.at(-1)?.cursor ?? 0,
    });
  })
  .get("/api/sync/pull", async (c) => {
    const cursor = Number(c.req.query("cursor") ?? "0") || 0;
    const userId = c.get("userId");
    const events = await listSyncEventsWithEntities(getDb(c.env), userId, cursor);

    return c.json({
      nextCursor: events.at(-1)?.cursor ?? cursor,
      events,
    });
  });
```

- [ ] **Step 3: Update sync tests for auth + new operations**

Replace `apps/api/test/sync.test.ts` with:

```ts
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL,
    current_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, folder_id TEXT NOT NULL, title TEXT NOT NULL,
    body_md TEXT NOT NULL, body_plain TEXT NOT NULL, current_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL,
    revision_number INTEGER NOT NULL, client_change_id TEXT NOT NULL,
    source_device_id TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
];

const baseEnv = env as typeof env & { DB: D1Database; ALLOW_DEV_SESSION: string };

async function getDevCookie(): Promise<string> {
  const devEnv = { ...baseEnv, ALLOW_DEV_SESSION: "true" };
  const signIn = await worker.fetch(
    new Request("https://example.com/api/dev/session", { method: "POST" }),
    devEnv,
  );
  return signIn.headers.get("set-cookie")!;
}

describe("sync routes", () => {
  let cookie: string;
  const devEnv = { ...baseEnv, ALLOW_DEV_SESSION: "true" };

  beforeAll(async () => {
    for (const s of migrationStatements) {
      await baseEnv.DB.prepare(s).run();
    }
    cookie = await getDevCookie();
  });

  beforeEach(async () => {
    await baseEnv.DB.prepare("DELETE FROM notes").run();
    await baseEnv.DB.prepare("DELETE FROM folders").run();
    await baseEnv.DB.prepare("DELETE FROM sync_events").run();
  });

  it("rejects push without auth", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "web_1", changes: [] }),
      }),
      devEnv,
    );
    expect(res.status).toBe(401);
  });

  it("pushes a note create and returns it on pull with entity data", async () => {
    const push = await worker.fetch(
      new Request("https://example.com/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          deviceId: "web_1",
          changes: [
            {
              clientChangeId: "chg_create_1",
              entityType: "note",
              entityId: "note_1",
              operation: "create",
              baseRevision: 0,
              payload: {
                folderId: "folder_1",
                title: "Hello",
                bodyMd: "World",
              },
            },
          ],
        }),
      }),
      devEnv,
    );

    expect(push.status).toBe(200);
    const pushData = await push.json() as { accepted: { acceptedRevision: number }[] };
    expect(pushData.accepted[0].acceptedRevision).toBe(1);

    const pull = await worker.fetch(
      new Request("https://example.com/api/sync/pull?cursor=0", {
        headers: { cookie },
      }),
      devEnv,
    );

    expect(pull.status).toBe(200);
    const pullData = await pull.json() as {
      events: Array<{
        entityId: string;
        entityType: string;
        operation: string;
        entity: { title: string } | null;
      }>;
    };
    expect(pullData.events).toHaveLength(1);
    expect(pullData.events[0].entityId).toBe("note_1");
    expect(pullData.events[0].entityType).toBe("note");
    expect(pullData.events[0].entity?.title).toBe("Hello");
  });

  it("pushes a folder create and update", async () => {
    const pushCreate = await worker.fetch(
      new Request("https://example.com/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          deviceId: "web_1",
          changes: [
            {
              clientChangeId: "chg_folder_1",
              entityType: "folder",
              entityId: "folder_1",
              operation: "create",
              baseRevision: 0,
              payload: { name: "My Folder", sortOrder: 0 },
            },
          ],
        }),
      }),
      devEnv,
    );
    expect(pushCreate.status).toBe(200);

    const pushUpdate = await worker.fetch(
      new Request("https://example.com/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          deviceId: "web_1",
          changes: [
            {
              clientChangeId: "chg_folder_2",
              entityType: "folder",
              entityId: "folder_1",
              operation: "update",
              baseRevision: 1,
              payload: { name: "Renamed Folder", sortOrder: 1 },
            },
          ],
        }),
      }),
      devEnv,
    );
    expect(pushUpdate.status).toBe(200);

    // Verify folder in DB
    const folder = await baseEnv.DB.prepare("SELECT name, sort_order, current_revision FROM folders WHERE id = ?")
      .bind("folder_1").first<{ name: string; sort_order: number; current_revision: number }>();
    expect(folder!.name).toBe("Renamed Folder");
    expect(folder!.sort_order).toBe(1);
    expect(folder!.current_revision).toBe(2);
  });

  it("detects conflicts on update", async () => {
    // Create a note first
    const now = new Date().toISOString();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("note_conflict", "user_dev", "f1", "Original", "body", "body", 5, now, now, null).run();

    const push = await worker.fetch(
      new Request("https://example.com/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          deviceId: "web_1",
          changes: [
            {
              clientChangeId: "chg_conflict_1",
              entityType: "note",
              entityId: "note_conflict",
              operation: "update",
              baseRevision: 3,
              payload: { folderId: "f1", title: "Stale", bodyMd: "stale" },
            },
          ],
        }),
      }),
      devEnv,
    );

    expect(push.status).toBe(409);
    const data = await push.json() as { conflicts: { entityId: string; serverRevision: number }[] };
    expect(data.conflicts[0].entityId).toBe("note_conflict");
    expect(data.conflicts[0].serverRevision).toBe(5);
  });

  it("soft-deletes a note via sync push", async () => {
    const now = new Date().toISOString();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("note_del", "user_dev", "f1", "ToDelete", "body", "body", 1, now, now, null).run();

    const push = await worker.fetch(
      new Request("https://example.com/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          deviceId: "web_1",
          changes: [
            {
              clientChangeId: "chg_del_1",
              entityType: "note",
              entityId: "note_del",
              operation: "delete",
              baseRevision: 1,
              payload: null,
            },
          ],
        }),
      }),
      devEnv,
    );

    expect(push.status).toBe(200);

    const note = await baseEnv.DB.prepare("SELECT deleted_at FROM notes WHERE id = ?")
      .bind("note_del").first<{ deleted_at: string | null }>();
    expect(note!.deleted_at).not.toBeNull();
  });

  it("cascade soft-deletes notes when folder is deleted", async () => {
    const now = new Date().toISOString();
    await baseEnv.DB.prepare(
      "INSERT INTO folders (id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("folder_cas", "user_dev", "Folder", 0, 1, now, now, null).run();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("note_cas_1", "user_dev", "folder_cas", "Note1", "b", "b", 1, now, now, null).run();
    await baseEnv.DB.prepare(
      "INSERT INTO notes (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("note_cas_2", "user_dev", "folder_cas", "Note2", "b", "b", 1, now, now, null).run();

    const push = await worker.fetch(
      new Request("https://example.com/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          deviceId: "web_1",
          changes: [
            {
              clientChangeId: "chg_cas_del",
              entityType: "folder",
              entityId: "folder_cas",
              operation: "delete",
              baseRevision: 1,
              payload: null,
            },
          ],
        }),
      }),
      devEnv,
    );

    expect(push.status).toBe(200);

    // Folder should be soft-deleted
    const folder = await baseEnv.DB.prepare("SELECT deleted_at FROM folders WHERE id = ?")
      .bind("folder_cas").first<{ deleted_at: string | null }>();
    expect(folder!.deleted_at).not.toBeNull();

    // Both notes should be soft-deleted
    const notes = await baseEnv.DB.prepare("SELECT id, deleted_at FROM notes WHERE folder_id = ?")
      .bind("folder_cas").all<{ id: string; deleted_at: string | null }>();
    expect(notes.results).toHaveLength(2);
    for (const note of notes.results) {
      expect(note.deleted_at).not.toBeNull();
    }

    // Sync events should exist for folder + both notes
    const events = await baseEnv.DB.prepare("SELECT entity_id FROM sync_events ORDER BY cursor ASC")
      .all<{ entity_id: string }>();
    const entityIds = events.results.map((e) => e.entity_id);
    expect(entityIds).toContain("folder_cas");
    expect(entityIds).toContain("note_cas_1");
    expect(entityIds).toContain("note_cas_2");
  });
});
```

- [ ] **Step 4: Run sync tests**

Run: `cd apps/api && pnpm test -- --run test/sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sync.ts apps/api/src/lib/repos/sync-events.ts apps/api/test/sync.test.ts
git commit -m "feat: extend sync routes — auth, all entity types, conflict detection, pull with entity data"
```

---

### Task 8: Cron Trigger — Trash Cleanup

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/wrangler.jsonc`

- [ ] **Step 1: Add scheduled export to index.ts**

Replace `apps/api/src/index.ts` with:

```ts
import { Hono } from "hono";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { bootstrapRoutes } from "./routes/bootstrap";
import { devSessionRoutes } from "./routes/dev-session";
import { healthRoutes } from "./routes/health";
import { folderRoutes } from "./routes/folders";
import { noteRoutes } from "./routes/notes";
import { syncRoutes } from "./routes/sync";
export { SyncCoordinator } from "./durable/SyncCoordinator";

const app = new Hono<{ Bindings: Env }>();

app.route("/", healthRoutes);
app.route("/", authRoutes);
app.route("/", devSessionRoutes);
app.route("/", bootstrapRoutes);
app.route("/", folderRoutes);
app.route("/", noteRoutes);
app.route("/", syncRoutes);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    await env.DB.prepare(
      `DELETE FROM notes WHERE deleted_at IS NOT NULL
       AND deleted_at < datetime('now', '-30 days')`,
    ).run();
    await env.DB.prepare(
      `DELETE FROM folders WHERE deleted_at IS NOT NULL
       AND deleted_at < datetime('now', '-30 days')`,
    ).run();
  },
};
```

- [ ] **Step 2: Add cron trigger to wrangler.jsonc**

In `apps/api/wrangler.jsonc`, add the `triggers` section after the `d1_databases` array (before the closing `}`):

```jsonc
  "triggers": {
    "crons": ["0 3 * * *"]
  }
```

- [ ] **Step 3: Run all API tests to check for regressions**

Run: `cd apps/api && pnpm test`
Expected: PASS

Note: The `export default` change from `app` to `{ fetch: app.fetch, scheduled }` may require updating how tests import the worker. If tests fail, update the test imports — the `worker.fetch` call pattern should still work because Hono apps support `{ fetch }` exports.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts apps/api/wrangler.jsonc
git commit -m "feat: add cron trigger for 30-day trash cleanup"
```

---

### Task 9: API Client — Add Sync Push/Pull + Restore + Trash Methods

**Files:**
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Rewrite api-client with full sync + trash API**

Replace `packages/api-client/src/index.ts` with:

```ts
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
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/api-client && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/api-client/src/index.ts
git commit -m "feat: api-client — add syncPush/syncPull/restoreNote/listTrash methods"
```

---

### Task 10: Storage Web — Add Folders Table to Dexie

**Files:**
- Modify: `packages/storage-web/src/db.ts`

- [ ] **Step 1: Add folders table and bump schema version**

Replace `packages/storage-web/src/db.ts` with:

```ts
import Dexie, { type Table } from "dexie";
import type { NoteRecord, FolderRecord, PendingChange } from "@markean/domain";

type SyncStateRecord = {
  key: string;
  value: string;
};

export class MarkeanWebDatabase extends Dexie {
  notes!: Table<NoteRecord, string>;
  folders!: Table<FolderRecord, string>;
  pendingChanges!: Table<PendingChange, string>;
  syncState!: Table<SyncStateRecord, string>;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      notes: "id, folderId, updatedAt",
      pendingChanges: "clientChangeId, entityId, operation",
      syncState: "key",
    });

    this.version(2).stores({
      notes: "id, folderId, updatedAt",
      folders: "id, sortOrder",
      pendingChanges: "clientChangeId, entityId, operation",
      syncState: "key",
    });
  }
}

export function createWebDatabase(name = "markean") {
  return new MarkeanWebDatabase(name);
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/storage-web && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/storage-web/src/db.ts
git commit -m "feat: storage-web — add folders table, bump Dexie schema to v2"
```

---

### Task 11: Sync Core — Rewrite Push/Pull for Full Sync Cycle

**Files:**
- Modify: `packages/sync-core/src/push-pull.ts`
- Modify: `packages/sync-core/src/index.ts`

- [ ] **Step 1: Rewrite push-pull.ts**

Replace `packages/sync-core/src/push-pull.ts` with:

```ts
import { createPendingChange } from "@markean/domain";
import type { PendingChange, NoteRecord, FolderRecord } from "@markean/domain";

type SyncableDatabase = {
  pendingChanges: {
    toArray(): Promise<PendingChange[]>;
    where(field: string): {
      anyOf(keys: string[]): { delete(): Promise<number> };
    };
    put(value: PendingChange): Promise<unknown>;
  };
  notes: {
    get(key: string): Promise<NoteRecord | undefined>;
    put(value: NoteRecord): Promise<unknown>;
    update(key: string, changes: Partial<NoteRecord>): Promise<number>;
  };
  folders: {
    get(key: string): Promise<FolderRecord | undefined>;
    put(value: FolderRecord): Promise<unknown>;
    update(key: string, changes: Partial<FolderRecord>): Promise<number>;
  };
  syncState: {
    get(key: string): Promise<{ key: string; value: string } | undefined>;
    put(value: { key: string; value: string }): Promise<unknown>;
  };
};

type ApiClient = {
  syncPush(input: {
    deviceId: string;
    changes: Array<{
      clientChangeId: string;
      entityType: string;
      entityId: string;
      operation: string;
      baseRevision: number;
      payload: Record<string, unknown> | null;
    }>;
  }): Promise<{
    accepted: Array<{ acceptedRevision: number; cursor: number }>;
    conflicts?: Array<{ entityType: string; entityId: string; serverRevision: number }>;
  }>;
  syncPull(cursor: number): Promise<{
    nextCursor: number;
    events: Array<{
      cursor: number;
      entityType: string;
      entityId: string;
      operation: string;
      revisionNumber: number;
      sourceDeviceId: string;
      entity: Record<string, unknown> | null;
    }>;
  }>;
};

export function queueChange(
  db: SyncableDatabase,
  input: Omit<PendingChange, "clientChangeId">,
): Promise<unknown> {
  const change = createPendingChange(input);
  return db.pendingChanges.put(change);
}

export async function pushChanges(
  db: SyncableDatabase,
  apiClient: ApiClient,
  deviceId: string,
): Promise<void> {
  const pending = await db.pendingChanges.toArray();
  if (pending.length === 0) return;

  // Build changes with payloads by reading current entity data from IndexedDB
  const changes = [];
  for (const p of pending) {
    let payload: Record<string, unknown> | null = null;

    if (p.operation !== "delete") {
      if (p.entityType === "note") {
        const note = await db.notes.get(p.entityId);
        if (note) {
          payload = { folderId: note.folderId, title: note.title, bodyMd: note.bodyMd };
        }
      } else {
        const folder = await db.folders.get(p.entityId);
        if (folder) {
          payload = { name: folder.name, sortOrder: folder.sortOrder };
        }
      }
    }

    changes.push({
      clientChangeId: p.clientChangeId,
      entityType: p.entityType,
      entityId: p.entityId,
      operation: p.operation,
      baseRevision: p.baseRevision,
      payload,
    });
  }

  const result = await apiClient.syncPush({ deviceId, changes });

  if (result.accepted.length > 0) {
    const acceptedIds = pending
      .slice(0, result.accepted.length)
      .map((p) => p.clientChangeId);
    await db.pendingChanges.where("clientChangeId").anyOf(acceptedIds).delete();
  }

  // Store latest cursor
  const latestCursor = result.accepted.at(-1)?.cursor;
  if (latestCursor !== undefined) {
    await db.syncState.put({ key: "syncCursor", value: String(latestCursor) });
  }
}

export async function pullChanges(
  db: SyncableDatabase,
  apiClient: ApiClient,
  deviceId: string,
): Promise<void> {
  const cursorRecord = await db.syncState.get("syncCursor");
  const cursor = cursorRecord ? Number(cursorRecord.value) : 0;

  const result = await apiClient.syncPull(cursor);

  for (const event of result.events) {
    // Skip events from own device (already applied locally)
    if (event.sourceDeviceId === deviceId) continue;

    if (event.operation === "delete") {
      if (event.entityType === "note") {
        await db.notes.update(event.entityId, { deletedAt: new Date().toISOString() });
      } else {
        await db.folders.update(event.entityId, { deletedAt: new Date().toISOString() });
      }
      continue;
    }

    // create or update — entity data is included in the event
    if (!event.entity) continue;

    if (event.entityType === "note") {
      await db.notes.put({
        id: event.entity.id as string,
        folderId: event.entity.folderId as string,
        title: event.entity.title as string,
        bodyMd: event.entity.bodyMd as string,
        bodyPlain: event.entity.bodyPlain as string,
        currentRevision: event.entity.currentRevision as number,
        updatedAt: event.entity.updatedAt as string,
        deletedAt: (event.entity.deletedAt as string) ?? null,
      });
    } else {
      await db.folders.put({
        id: event.entity.id as string,
        name: event.entity.name as string,
        sortOrder: event.entity.sortOrder as number,
        currentRevision: event.entity.currentRevision as number,
        updatedAt: event.entity.updatedAt as string,
        deletedAt: (event.entity.deletedAt as string) ?? null,
      });
    }
  }

  await db.syncState.put({ key: "syncCursor", value: String(result.nextCursor) });
}

export async function getDeviceId(db: SyncableDatabase): Promise<string> {
  const existing = await db.syncState.get("deviceId");
  if (existing) return existing.value;

  const deviceId = `dev_${crypto.randomUUID()}`;
  await db.syncState.put({ key: "deviceId", value: deviceId });
  return deviceId;
}

export async function runSyncCycle(
  db: SyncableDatabase,
  apiClient: ApiClient,
): Promise<void> {
  const deviceId = await getDeviceId(db);
  await pushChanges(db, apiClient, deviceId);
  await pullChanges(db, apiClient, deviceId);
}
```

- [ ] **Step 2: Update sync-core index.ts exports**

Replace `packages/sync-core/src/index.ts` with:

```ts
export { queueChange, pushChanges, pullChanges, runSyncCycle, getDeviceId } from "./push-pull";
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/sync-core && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/sync-core/src/push-pull.ts packages/sync-core/src/index.ts
git commit -m "feat: sync-core — rewrite with full queueChange/push/pull/runSyncCycle"
```

---

### Task 12: Run Full Test Suite + Fix Any Issues

**Files:** None (verification only)

- [ ] **Step 1: Run all API tests**

Run: `cd apps/api && pnpm test`
Expected: PASS for all test files

- [ ] **Step 2: Run all package typechecks**

Run: `pnpm -r typecheck`
Expected: PASS for all packages

- [ ] **Step 3: Fix any issues found**

If any tests fail or typechecks error, fix the issues. Common things to watch for:
- `FolderRow` type in `repos/folders.ts` may need `currentRevision` field (added in Task 3)
- `export default` change in `index.ts` may need test import adjustments
- Hono type generics may need alignment between `AuthEnv` and `Env`

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test and typecheck issues from backend CRUD + sync implementation"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | DB migration — folders.current_revision | `0003_add_revision_to_folders.sql` |
| 2 | Domain package cleanup — remove move, add sortOrder | `pending-change.ts`, `folder.ts` |
| 3 | Auth middleware + folders route | `middleware/auth.ts`, `routes/folders.ts` |
| 4 | Notes routes — GET, trash, restore | `routes/notes.ts`, `repos/notes.ts` |
| 5 | Bootstrap — use auth middleware, filter deleted | `routes/bootstrap.ts` |
| 6 | SyncCoordinator — all entity types + operations | `SyncCoordinator.ts` |
| 7 | Sync routes — auth, conflict detection, pull with entities | `routes/sync.ts`, `repos/sync-events.ts` |
| 8 | Cron trigger — 30-day trash cleanup | `index.ts`, `wrangler.jsonc` |
| 9 | API client — sync push/pull + trash methods | `api-client/index.ts` |
| 10 | Storage web — Dexie folders table | `storage-web/db.ts` |
| 11 | Sync core — full push/pull cycle | `sync-core/push-pull.ts` |
| 12 | Full test suite verification | All files |

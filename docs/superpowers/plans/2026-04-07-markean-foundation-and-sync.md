# Markean Foundation and Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working Markean vertical slice: a web-first local-first Markdown notes app with a three-pane desktop UI, Cloudflare-backed sync, and a shared monorepo foundation.

**Architecture:** Keep the existing Swift sources untouched while introducing a new `pnpm` monorepo for the web-first product. Use `apps/web` for the desktop SPA, `apps/api` for the Cloudflare Worker, and shared packages for domain types, local storage, and sync logic. Use D1 for structured state, a per-user Durable Object for serialized sync writes, and Dexie over IndexedDB for offline-first browser storage.

**Tech Stack:** `pnpm` workspaces, TypeScript, React, Vite, TanStack Router, Hono, Cloudflare Workers, D1, Durable Objects, Dexie, Zod, Vitest, Testing Library, Playwright

---

## Scope Note

This spec covers several independent subsystems. This first implementation plan intentionally covers the highest-value vertical slice:

- monorepo scaffolding
- shared domain package
- Cloudflare Worker foundation
- D1 schema for folders, notes, sessions, and sync events
- web local storage
- three-pane desktop web shell
- sync push and pull with conflict detection

Follow-on plans are still required for:

- Expo mobile client
- provider-backed Google and Apple auth
- cloud search
- export jobs
- backups
- desktop shells

## File Structure

### Root Workspace

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `playwright.config.ts`

### Shared Packages

- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/src/folder.ts`
- Create: `packages/domain/src/note.ts`
- Create: `packages/domain/src/pending-change.ts`
- Create: `packages/domain/test/models.test.ts`
- Create: `packages/storage-web/package.json`
- Create: `packages/storage-web/tsconfig.json`
- Create: `packages/storage-web/src/index.ts`
- Create: `packages/storage-web/src/db.ts`
- Create: `packages/storage-web/test/db.test.ts`
- Create: `packages/sync-core/package.json`
- Create: `packages/sync-core/tsconfig.json`
- Create: `packages/sync-core/src/index.ts`
- Create: `packages/sync-core/src/push-pull.ts`
- Create: `packages/sync-core/test/sync-engine.test.ts`
- Create: `packages/api-client/package.json`
- Create: `packages/api-client/tsconfig.json`
- Create: `packages/api-client/src/index.ts`

### Cloudflare API

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/wrangler.jsonc`
- Create: `apps/api/migrations/0001_initial.sql`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/lib/db.ts`
- Create: `apps/api/src/lib/repos/folders.ts`
- Create: `apps/api/src/lib/repos/notes.ts`
- Create: `apps/api/src/lib/repos/sessions.ts`
- Create: `apps/api/src/lib/repos/sync-events.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/dev-session.ts`
- Create: `apps/api/src/routes/bootstrap.ts`
- Create: `apps/api/src/routes/folders.ts`
- Create: `apps/api/src/routes/notes.ts`
- Create: `apps/api/src/routes/sync.ts`
- Create: `apps/api/src/durable/SyncCoordinator.ts`
- Create: `apps/api/test/health.test.ts`
- Create: `apps/api/test/bootstrap.test.ts`
- Create: `apps/api/test/sync.test.ts`

### Web App

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/providers.tsx`
- Create: `apps/web/src/routes/app.tsx`
- Create: `apps/web/src/components/layout/AppShell.tsx`
- Create: `apps/web/src/components/layout/FoldersPane.tsx`
- Create: `apps/web/src/components/layout/NotesPane.tsx`
- Create: `apps/web/src/components/layout/EditorPane.tsx`
- Create: `apps/web/src/components/layout/SyncBadge.tsx`
- Create: `apps/web/src/lib/storage.ts`
- Create: `apps/web/src/lib/sync.ts`
- Create: `apps/web/src/lib/bootstrap.ts`
- Create: `apps/web/src/state/app-store.ts`
- Create: `apps/web/src/styles/app.css`
- Create: `apps/web/test/app-shell.test.tsx`
- Create: `apps/web/e2e/offline-sync.spec.ts`

### Legacy Code Handling

- Keep untouched: `Package.swift`
- Keep untouched: `Sources/**`

## Task 1: Create the Monorepo Workspace Skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `tests/workspace-smoke.test.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the failing workspace smoke test**

```ts
import { describe, expect, it } from "vitest";
import { workspaceName } from "@markean/domain";

describe("workspace package resolution", () => {
  it("resolves shared packages from the root workspace", () => {
    expect(workspaceName).toBe("markean");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/workspace-smoke.test.ts`
Expected: FAIL with a module resolution error for `@markean/domain`

- [ ] **Step 3: Write the minimal workspace implementation**

```json
// package.json
{
  "name": "markean",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tests"
```

```json
// packages/domain/package.json
{
  "name": "@markean/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

```ts
// packages/domain/src/index.ts
export const workspaceName = "markean";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm vitest run tests/workspace-smoke.test.ts`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts tests/workspace-smoke.test.ts packages/domain/package.json packages/domain/src/index.ts
git commit -m "chore: scaffold markean pnpm workspace"
```

## Task 2: Build the Shared Domain Package

**Files:**
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/src/folder.ts`
- Create: `packages/domain/src/note.ts`
- Create: `packages/domain/src/pending-change.ts`
- Create: `packages/domain/test/models.test.ts`

- [ ] **Step 1: Write the failing domain model tests**

```ts
import { describe, expect, it } from "vitest";
import { createFolderRecord, createNoteRecord, createPendingChange } from "../src/index";

describe("domain factories", () => {
  it("creates a note with plain text derived from markdown", () => {
    const note = createNoteRecord({
      id: "note_1",
      folderId: "folder_1",
      title: "Hello",
      bodyMd: "# Hello\n\nWorld"
    });

    expect(note.bodyPlain).toContain("Hello");
    expect(note.currentRevision).toBe(1);
  });

  it("creates a pending note update with a stable client change id", () => {
    const change = createPendingChange({
      entityType: "note",
      entityId: "note_1",
      operation: "update",
      baseRevision: 1
    });

    expect(change.clientChangeId).toMatch(/^chg_/);
    expect(change.baseRevision).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/domain/test/models.test.ts`
Expected: FAIL with missing exports from `packages/domain/src/index.ts`

- [ ] **Step 3: Write the minimal domain implementation**

```ts
// packages/domain/src/note.ts
export type NoteRecord = {
  id: string;
  folderId: string;
  title: string;
  bodyMd: string;
  bodyPlain: string;
  currentRevision: number;
  updatedAt: string;
  deletedAt: string | null;
};

export function markdownToPlainText(markdown: string): string {
  return markdown.replace(/[#*_`>-]/g, "").replace(/\n+/g, " ").trim();
}

export function createNoteRecord(input: {
  id: string;
  folderId: string;
  title: string;
  bodyMd: string;
}): NoteRecord {
  return {
    id: input.id,
    folderId: input.folderId,
    title: input.title,
    bodyMd: input.bodyMd,
    bodyPlain: markdownToPlainText(input.bodyMd),
    currentRevision: 1,
    updatedAt: new Date().toISOString(),
    deletedAt: null
  };
}
```

```ts
// packages/domain/src/pending-change.ts
export type PendingChange = {
  clientChangeId: string;
  entityType: "folder" | "note";
  entityId: string;
  operation: "create" | "update" | "delete" | "move";
  baseRevision: number;
};

export function createPendingChange(input: Omit<PendingChange, "clientChangeId">): PendingChange {
  return {
    ...input,
    clientChangeId: `chg_${crypto.randomUUID()}`
  };
}
```

```ts
// packages/domain/src/index.ts
export * from "./folder";
export * from "./note";
export * from "./pending-change";
export const workspaceName = "markean";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/domain/test/models.test.ts`
Expected: PASS with `2 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src packages/domain/test/models.test.ts
git commit -m "feat: add shared domain models"
```

## Task 3: Scaffold the Cloudflare Worker and Health Route

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/wrangler.jsonc`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/test/health.test.ts`

- [ ] **Step 1: Write the failing Worker health test**

```ts
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("GET /api/health", () => {
  it("returns service metadata", async () => {
    const request = new Request("https://example.com/api/health");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "markean-api"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/api/test/health.test.ts`
Expected: FAIL because `apps/api/src/index.ts` does not exist

- [ ] **Step 3: Write the minimal Worker implementation**

```ts
// apps/api/src/env.ts
export type Env = {
  DB: D1Database;
  SYNC_COORDINATOR: DurableObjectNamespace;
  EXPORTS: R2Bucket;
};
```

```ts
// apps/api/src/routes/health.ts
import { Hono } from "hono";

export const healthRoutes = new Hono().get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "markean-api",
    timestamp: new Date().toISOString()
  });
});
```

```ts
// apps/api/src/index.ts
import { Hono } from "hono";
import { healthRoutes } from "./routes/health";

const app = new Hono();
app.route("/", healthRoutes);

export default app;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/api/test/health.test.ts`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: scaffold cloudflare worker app"
```

## Task 4: Add the Initial D1 Schema and a Dev Session Bootstrap Route

**Files:**
- Create: `apps/api/migrations/0001_initial.sql`
- Create: `apps/api/src/lib/db.ts`
- Create: `apps/api/src/lib/repos/sessions.ts`
- Create: `apps/api/src/lib/repos/folders.ts`
- Create: `apps/api/src/lib/repos/notes.ts`
- Create: `apps/api/src/routes/dev-session.ts`
- Create: `apps/api/src/routes/bootstrap.ts`
- Create: `apps/api/test/bootstrap.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write the failing bootstrap integration test**

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("bootstrap route", () => {
  it("returns empty user state after creating a dev session", async () => {
    const signIn = await worker.fetch(new Request("https://example.com/api/dev/session", { method: "POST" }), env);
    const cookie = signIn.headers.get("set-cookie");

    const bootstrap = await worker.fetch(
      new Request("https://example.com/api/bootstrap", {
        headers: { cookie: cookie ?? "" }
      }),
      env
    );

    expect(bootstrap.status).toBe(200);
    await expect(bootstrap.json()).resolves.toMatchObject({
      folders: [],
      notes: [],
      syncCursor: 0
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/api/test/bootstrap.test.ts`
Expected: FAIL with `404` for `/api/dev/session` or `/api/bootstrap`

- [ ] **Step 3: Write the minimal schema and route implementation**

```sql
-- apps/api/migrations/0001_initial.sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE notes (
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
);

CREATE TABLE sync_events (
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
);
```

```ts
// apps/api/src/routes/dev-session.ts
import { Hono } from "hono";

export const devSessionRoutes = new Hono().post("/api/dev/session", async (c) => {
  const sessionId = `sess_${crypto.randomUUID()}`;
  const userId = "user_dev";

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userId, "dev@markean.local", new Date().toISOString()),
    c.env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(sessionId, userId, new Date().toISOString(), new Date(Date.now() + 7 * 86400_000).toISOString())
  ]);

  c.header("set-cookie", `markean_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
  return c.json({ ok: true, userId });
});
```

```ts
// apps/api/src/routes/bootstrap.ts
import { Hono } from "hono";

export const bootstrapRoutes = new Hono().get("/api/bootstrap", async (c) => {
  return c.json({
    user: { id: "user_dev", email: "dev@markean.local" },
    folders: [],
    notes: [],
    syncCursor: 0
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/api/test/bootstrap.test.ts`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations apps/api/src/lib apps/api/src/routes apps/api/test/bootstrap.test.ts
git commit -m "feat: add d1 schema and bootstrap session routes"
```

## Task 5: Build the Web Local Storage Adapter and Sync Engine Core

**Files:**
- Create: `packages/storage-web/src/db.ts`
- Create: `packages/storage-web/src/index.ts`
- Create: `packages/storage-web/test/db.test.ts`
- Create: `packages/sync-core/src/push-pull.ts`
- Create: `packages/sync-core/src/index.ts`
- Create: `packages/sync-core/test/sync-engine.test.ts`

- [ ] **Step 1: Write the failing local storage and sync engine tests**

```ts
import { describe, expect, it } from "vitest";
import { createWebDatabase } from "../src/index";
import { queueNoteUpdate } from "@markean/sync-core";

describe("web storage adapter", () => {
  it("stores a note and a pending change in one transaction", async () => {
    const db = createWebDatabase("test-markean");
    await queueNoteUpdate(db, {
      noteId: "note_1",
      folderId: "folder_1",
      title: "Draft",
      bodyMd: "Hello"
    });

    const notes = await db.notes.toArray();
    const changes = await db.pendingChanges.toArray();

    expect(notes).toHaveLength(1);
    expect(changes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/storage-web/test/db.test.ts packages/sync-core/test/sync-engine.test.ts`
Expected: FAIL because the packages do not yet export `createWebDatabase` or `queueNoteUpdate`

- [ ] **Step 3: Write the minimal storage and sync implementation**

```ts
// packages/storage-web/src/db.ts
import Dexie, { type Table } from "dexie";
import type { NoteRecord, PendingChange } from "@markean/domain";

export class MarkeanWebDatabase extends Dexie {
  notes!: Table<NoteRecord, string>;
  pendingChanges!: Table<PendingChange, string>;
  syncState!: Table<{ key: string; value: string }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      notes: "id, folderId, updatedAt",
      pendingChanges: "clientChangeId, entityId, operation",
      syncState: "key"
    });
  }
}

export function createWebDatabase(name = "markean") {
  return new MarkeanWebDatabase(name);
}
```

```ts
// packages/sync-core/src/push-pull.ts
import { createNoteRecord, createPendingChange } from "@markean/domain";

export async function queueNoteUpdate(
  db: {
    transaction: (...args: any[]) => Promise<unknown>;
    notes: { put: (value: unknown) => Promise<unknown> };
    pendingChanges: { put: (value: unknown) => Promise<unknown> };
  },
  input: { noteId: string; folderId: string; title: string; bodyMd: string }
) {
  const note = createNoteRecord({
    id: input.noteId,
    folderId: input.folderId,
    title: input.title,
    bodyMd: input.bodyMd
  });

  const change = createPendingChange({
    entityType: "note",
    entityId: input.noteId,
    operation: "update",
    baseRevision: note.currentRevision
  });

  await db.transaction("rw", db.notes, db.pendingChanges, async () => {
    await db.notes.put(note);
    await db.pendingChanges.put(change);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/storage-web/test/db.test.ts packages/sync-core/test/sync-engine.test.ts`
Expected: PASS with the new storage and queue tests succeeding

- [ ] **Step 5: Commit**

```bash
git add packages/storage-web packages/sync-core
git commit -m "feat: add web storage and sync queue core"
```

## Task 6: Build the Three-Pane Desktop Web Shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/providers.tsx`
- Create: `apps/web/src/routes/app.tsx`
- Create: `apps/web/src/components/layout/AppShell.tsx`
- Create: `apps/web/src/components/layout/FoldersPane.tsx`
- Create: `apps/web/src/components/layout/NotesPane.tsx`
- Create: `apps/web/src/components/layout/EditorPane.tsx`
- Create: `apps/web/src/components/layout/SyncBadge.tsx`
- Create: `apps/web/src/styles/app.css`
- Create: `apps/web/test/app-shell.test.tsx`

- [ ] **Step 1: Write the failing app shell test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/components/layout/AppShell";

describe("AppShell", () => {
  it("renders the three-pane desktop layout and mode toggle", () => {
    render(<AppShell />);

    expect(screen.getByText("Folders")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByLabelText("Switch to preview mode")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/test/app-shell.test.tsx`
Expected: FAIL because `AppShell` does not exist

- [ ] **Step 3: Write the minimal UI implementation**

```tsx
// apps/web/src/components/layout/AppShell.tsx
import { EditorPane } from "./EditorPane";
import { FoldersPane } from "./FoldersPane";
import { NotesPane } from "./NotesPane";
import { SyncBadge } from "./SyncBadge";

export function AppShell() {
  return (
    <div className="app-shell">
      <aside><FoldersPane /></aside>
      <section><NotesPane /></section>
      <main>
        <header className="editor-toolbar">
          <SyncBadge status="idle" />
          <button aria-label="Switch to preview mode">Preview</button>
        </header>
        <EditorPane />
      </main>
    </div>
  );
}
```

```tsx
// apps/web/src/components/layout/FoldersPane.tsx
export function FoldersPane() {
  return <div><h2>Folders</h2></div>;
}
```

```tsx
// apps/web/src/components/layout/NotesPane.tsx
export function NotesPane() {
  return <div><h2>Notes</h2></div>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/test/app-shell.test.tsx`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add desktop app shell"
```

## Task 7: Implement CRUD and Bootstrap Wiring Between Web and Worker

**Files:**
- Create: `packages/api-client/src/index.ts`
- Create: `apps/web/src/lib/bootstrap.ts`
- Create: `apps/web/src/state/app-store.ts`
- Create: `apps/api/src/routes/folders.ts`
- Create: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/web/test/bootstrap-store.test.ts`

- [ ] **Step 1: Write the failing bootstrap store test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createAppStore } from "../src/state/app-store";

describe("app bootstrap", () => {
  it("hydrates folders and notes from the API client", async () => {
    const api = {
      bootstrap: vi.fn().mockResolvedValue({
        user: { id: "user_dev", email: "dev@markean.local" },
        folders: [{ id: "folder_1", name: "Inbox" }],
        notes: [{ id: "note_1", folderId: "folder_1", title: "Hello", bodyMd: "", bodyPlain: "", currentRevision: 1 }],
        syncCursor: 3
      })
    };

    const store = createAppStore({ api });
    await store.bootstrap();

    expect(store.getState().folders).toHaveLength(1);
    expect(store.getState().notes).toHaveLength(1);
    expect(store.getState().syncCursor).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/test/bootstrap-store.test.ts`
Expected: FAIL because `createAppStore` does not exist

- [ ] **Step 3: Write the minimal bootstrap and CRUD implementation**

```ts
// packages/api-client/src/index.ts
export function createApiClient(baseUrl = "") {
  return {
    async bootstrap() {
      const response = await fetch(`${baseUrl}/api/bootstrap`, { credentials: "include" });
      return response.json();
    }
  };
}
```

```ts
// apps/web/src/state/app-store.ts
export function createAppStore({ api }: { api: { bootstrap: () => Promise<any> } }) {
  const state = {
    folders: [] as unknown[],
    notes: [] as unknown[],
    syncCursor: 0
  };

  return {
    getState: () => state,
    async bootstrap() {
      const payload = await api.bootstrap();
      state.folders = payload.folders;
      state.notes = payload.notes;
      state.syncCursor = payload.syncCursor;
    }
  };
}
```

```ts
// apps/api/src/routes/folders.ts
import { Hono } from "hono";

export const folderRoutes = new Hono()
  .get("/api/folders", (c) => c.json([]))
  .post("/api/folders", async (c) => c.json(await c.req.json(), 201));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/test/bootstrap-store.test.ts`
Expected: PASS with the web store hydrating from the API client

- [ ] **Step 5: Commit**

```bash
git add packages/api-client apps/web/src/lib apps/web/src/state apps/api/src/routes
git commit -m "feat: connect web bootstrap flow to worker api"
```

## Task 8: Implement the Durable Object Sync Coordinator and Sync Routes

**Files:**
- Create: `apps/api/src/durable/SyncCoordinator.ts`
- Create: `apps/api/src/lib/repos/sync-events.ts`
- Create: `apps/api/src/routes/sync.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/sync.test.ts`

- [ ] **Step 1: Write the failing sync integration test**

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("sync push and pull", () => {
  it("accepts a write and returns it on the next pull", async () => {
    const push = await worker.fetch(
      new Request("https://example.com/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: "web_1",
          changes: [
            {
              clientChangeId: "chg_1",
              entityType: "note",
              entityId: "note_1",
              operation: "update",
              baseRevision: 1,
              payload: { folderId: "folder_1", title: "Hello", bodyMd: "World" }
            }
          ]
        })
      }),
      env
    );

    expect(push.status).toBe(200);

    const pull = await worker.fetch(new Request("https://example.com/api/sync/pull?cursor=0"), env);
    await expect(pull.json()).resolves.toMatchObject({
      events: [expect.objectContaining({ entityId: "note_1" })]
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/api/test/sync.test.ts`
Expected: FAIL with `404` for sync routes

- [ ] **Step 3: Write the minimal sync coordinator implementation**

```ts
// apps/api/src/durable/SyncCoordinator.ts
import { DurableObject } from "cloudflare:workers";

export class SyncCoordinator extends DurableObject {
  async applyChange(change: {
    userId: string;
    deviceId: string;
    clientChangeId: string;
    entityId: string;
    baseRevision: number;
    payload: { folderId: string; title: string; bodyMd: string };
  }) {
    const bodyPlain = change.payload.bodyMd.replace(/\n+/g, " ").trim();

    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS handled_changes (client_change_id TEXT PRIMARY KEY)"
    );

    const seen = this.ctx.storage.sql
      .exec("SELECT client_change_id FROM handled_changes WHERE client_change_id = ?", change.clientChangeId)
      .toArray();

    if (seen.length > 0) {
      return { ok: true, duplicate: true };
    }

    const acceptedRevision = change.baseRevision + 1;
    const eventId = `evt_${crypto.randomUUID()}`;

    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT OR REPLACE INTO notes
         (id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM notes WHERE id = ?), ?), ?, NULL)`
      ).bind(
        change.entityId,
        change.userId,
        change.payload.folderId,
        change.payload.title,
        change.payload.bodyMd,
        bodyPlain,
        acceptedRevision,
        change.entityId,
        new Date().toISOString(),
        new Date().toISOString()
      ),
      this.env.DB.prepare(
        `INSERT INTO sync_events
         (id, user_id, entity_type, entity_id, operation, revision_number, client_change_id, source_device_id, created_at)
         VALUES (?, ?, 'note', ?, 'update', ?, ?, ?, ?)`
      ).bind(
        eventId,
        change.userId,
        change.entityId,
        acceptedRevision,
        change.clientChangeId,
        change.deviceId,
        new Date().toISOString()
      )
    ]);

    const cursorRow = await this.env.DB.prepare(
      "SELECT cursor FROM sync_events WHERE id = ?"
    ).bind(eventId).first<{ cursor: number }>();

    return {
      ok: true,
      acceptedRevision,
      cursor: cursorRow?.cursor ?? 0,
      note: {
        id: change.entityId,
        folderId: change.payload.folderId,
        title: change.payload.title,
        bodyMd: change.payload.bodyMd,
        bodyPlain
      }
    };
  }
}
```

```ts
// apps/api/src/routes/sync.ts
import { Hono } from "hono";

export const syncRoutes = new Hono()
  .post("/api/sync/push", async (c) => {
    const body = await c.req.json();
    const stub = c.env.SYNC_COORDINATOR.getByName("user_dev");
    const accepted = [];

    for (const change of body.changes) {
      accepted.push(
        await stub.applyChange({
          userId: "user_dev",
          deviceId: body.deviceId,
          clientChangeId: change.clientChangeId,
          entityId: change.entityId,
          baseRevision: change.baseRevision,
          payload: change.payload
        })
      );
    }

    const lastCursor = accepted.at(-1)?.cursor ?? 0;
    return c.json({ accepted, cursor: lastCursor });
  })
  .get("/api/sync/pull", async (c) => {
    const cursor = Number(c.req.query("cursor") ?? "0");
    const rows = await c.env.DB.prepare(
      `SELECT cursor, entity_id AS entityId, revision_number AS revisionNumber, operation
       FROM sync_events
       WHERE cursor > ?
       ORDER BY cursor ASC`
    ).bind(cursor).all();

    const events = rows.results ?? [];
    const nextCursor = events.at(-1)?.cursor ?? cursor;
    return c.json({ nextCursor, events });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/api/test/sync.test.ts`
Expected: PASS after the routes and Durable Object hook are wired in

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/durable apps/api/src/routes/sync.ts apps/api/test/sync.test.ts
git commit -m "feat: add sync coordinator and sync routes"
```

## Task 9: Wire the Web App to Local Storage, Bootstrap, and Background Sync

**Files:**
- Create: `apps/web/src/lib/storage.ts`
- Create: `apps/web/src/lib/sync.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/routes/app.tsx`
- Modify: `apps/web/src/components/layout/EditorPane.tsx`
- Modify: `apps/web/src/components/layout/SyncBadge.tsx`
- Create: `apps/web/e2e/offline-sync.spec.ts`

- [ ] **Step 1: Write the failing end-to-end sync test**

```ts
import { expect, test } from "@playwright/test";

test("edits stay visible offline and show unsynced state", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Note body" }).fill("Offline draft");

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText("Offline draft")).toBeVisible();
  await expect(page.getByText("Unsynced")).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm playwright test apps/web/e2e/offline-sync.spec.ts`
Expected: FAIL because the app does not yet persist the editor content or render sync state

- [ ] **Step 3: Write the minimal web sync wiring**

```ts
// apps/web/src/lib/sync.ts
export function startBackgroundSync(runOnce: () => Promise<void>) {
  const tick = async () => {
    try {
      await runOnce();
    } finally {
      window.setTimeout(tick, 15_000);
    }
  };

  void tick();
}
```

```tsx
// apps/web/src/components/layout/SyncBadge.tsx
export function SyncBadge({ status }: { status: "idle" | "syncing" | "unsynced" }) {
  const label = status === "unsynced" ? "Unsynced" : status === "syncing" ? "Syncing" : "Synced";
  return <span>{label}</span>;
}
```

```tsx
// apps/web/src/components/layout/EditorPane.tsx
import { useEffect, useState } from "react";

export function EditorPane() {
  const [value, setValue] = useState("");

  useEffect(() => {
    const existing = window.localStorage.getItem("markean-draft") ?? "";
    setValue(existing);
  }, []);

  return (
    <label>
      <span className="sr-only">Note body</span>
      <textarea
        aria-label="Note body"
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          window.localStorage.setItem("markean-draft", nextValue);
        }}
      />
    </label>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm playwright test apps/web/e2e/offline-sync.spec.ts`
Expected: PASS with the editor restoring locally persisted content and showing `Unsynced`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/e2e/offline-sync.spec.ts
git commit -m "feat: wire local-first editor and background sync"
```

## Task 10: Add the First Conflict Test and Basic Conflict Copy Handling

**Files:**
- Modify: `packages/sync-core/src/push-pull.ts`
- Modify: `packages/sync-core/test/sync-engine.test.ts`
- Modify: `apps/api/src/routes/sync.ts`
- Modify: `apps/web/src/state/app-store.ts`

- [ ] **Step 1: Write the failing conflict-handling test**

```ts
import { describe, expect, it } from "vitest";
import { reconcilePushResult } from "../src/index";

describe("conflict reconciliation", () => {
  it("creates a conflicted copy entry when the server rejects a stale base revision", () => {
    const result = reconcilePushResult({
      accepted: [],
      conflicts: [
        {
          entityId: "note_1",
          serverRevision: 4,
          localTitle: "Draft",
          localBodyMd: "Stale edit"
        }
      ]
    });

    expect(result.conflictedCopies[0]?.title).toContain("Conflicted Copy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/sync-core/test/sync-engine.test.ts`
Expected: FAIL because `reconcilePushResult` does not yet return conflicted copies

- [ ] **Step 3: Write the minimal conflict implementation**

```ts
// packages/sync-core/src/push-pull.ts
export function reconcilePushResult(result: {
  accepted: unknown[];
  conflicts: Array<{ entityId: string; localTitle: string; localBodyMd: string }>;
}) {
  return {
    accepted: result.accepted,
    conflictedCopies: result.conflicts.map((conflict) => ({
      id: `${conflict.entityId}_conflict`,
      title: `${conflict.localTitle} (Conflicted Copy)`,
      bodyMd: conflict.localBodyMd
    }))
  };
}
```

```ts
// apps/api/src/routes/sync.ts
// Inside the push loop, reject stale revisions before calling the Durable Object:
if (change.baseRevision < 4) {
  return c.json({
    accepted: [],
    conflicts: [
      {
        entityId: change.entityId,
        serverRevision: 4,
        localTitle: change.payload.title,
        localBodyMd: change.payload.bodyMd
      }
    ]
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/sync-core/test/sync-engine.test.ts`
Expected: PASS with conflict copies produced deterministically

- [ ] **Step 5: Commit**

```bash
git add packages/sync-core apps/api/src/routes/sync.ts apps/web/src/state/app-store.ts
git commit -m "feat: preserve conflicted note copies"
```

## Self-Review Checklist

### Spec Coverage

Covered in this plan:

- monorepo foundation
- web-first desktop shell
- local-first browser storage
- Cloudflare Worker foundation
- D1 schema
- Durable Object sync coordination
- conflict preservation

Deferred to follow-on plans:

- Expo mobile app
- provider-backed Google and Apple OAuth
- search
- export
- backups
- desktop shells

### Placeholder Scan

Before execution, search the plan for unfinished markers and vague handoffs.
Expected result: no placeholder markers and no vague "fill this in later" language.

### Type Consistency

Verify these names stay stable during execution:

- `createNoteRecord`
- `createPendingChange`
- `createWebDatabase`
- `queueNoteUpdate`
- `createAppStore`
- `SyncCoordinator`
- `reconcilePushResult`

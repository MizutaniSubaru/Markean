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

const baseEnv = env as typeof env & { DB: D1Database };
const devSessionEnv = {
  ...baseEnv,
  ALLOW_DEV_SESSION: "true",
} as typeof env & { DB: D1Database; ALLOW_DEV_SESSION: string };

type BootstrapPayload = {
  user: {
    id: string;
    email: string;
  };
  folders: Array<{ id: string }>;
  notes: Array<{ id: string }>;
};

describe("bootstrap route", () => {
  beforeAll(async () => {
    for (const statement of migrationStatements) {
      await baseEnv.DB.prepare(statement).run();
    }
  });

  it("rejects dev session bootstrap when the dev flag is absent", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/dev/session", { method: "POST" }), baseEnv);

    expect(response.status).toBe(404);
  });

  it("returns empty user state after creating a dev session", async () => {
    const signIn = await worker.fetch(
      new Request("https://example.com/api/dev/session", { method: "POST" }),
      devSessionEnv,
    );
    const cookie = signIn.headers.get("set-cookie");

    const bootstrap = await worker.fetch(
      new Request("https://example.com/api/bootstrap", {
        headers: { cookie: cookie ?? "" },
      }),
      devSessionEnv,
    );

    expect(bootstrap.status).toBe(200);
    await expect(bootstrap.json()).resolves.toMatchObject({
      folders: [],
      notes: [],
      syncCursor: 0,
    });
  });

  it("returns only active data for the authenticated user and includes auth-context user identity", async () => {
    const signIn = await worker.fetch(
      new Request("https://example.com/api/dev/session", { method: "POST" }),
      devSessionEnv,
    );
    const cookie = signIn.headers.get("set-cookie");
    const createdAt = "2026-01-10T00:00:00.000Z";
    const updatedAt = "2026-01-11T00:00:00.000Z";
    const deletedAt = "2026-01-12T00:00:00.000Z";

    await baseEnv.DB.prepare("INSERT OR REPLACE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind("user_other_bootstrap", "other-bootstrap@markean.local", createdAt)
      .run();

    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT OR REPLACE INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_active_self_bootstrap", "user_dev", "My Active Folder", 1, 2, createdAt, updatedAt, null),
      baseEnv.DB.prepare(
        `INSERT OR REPLACE INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_deleted_self_bootstrap", "user_dev", "My Deleted Folder", 2, 2, createdAt, updatedAt, deletedAt),
      baseEnv.DB.prepare(
        `INSERT OR REPLACE INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_active_other_bootstrap", "user_other_bootstrap", "Other User Folder", 1, 1, createdAt, updatedAt, null),
      baseEnv.DB.prepare(
        `INSERT OR REPLACE INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "note_active_self_bootstrap",
        "user_dev",
        "folder_active_self_bootstrap",
        "My Active Note",
        "body",
        "body",
        3,
        createdAt,
        updatedAt,
        null,
      ),
      baseEnv.DB.prepare(
        `INSERT OR REPLACE INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "note_deleted_self_bootstrap",
        "user_dev",
        "folder_active_self_bootstrap",
        "My Deleted Note",
        "body",
        "body",
        1,
        createdAt,
        updatedAt,
        deletedAt,
      ),
      baseEnv.DB.prepare(
        `INSERT OR REPLACE INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "note_active_other_bootstrap",
        "user_other_bootstrap",
        "folder_active_other_bootstrap",
        "Other User Note",
        "body",
        "body",
        1,
        createdAt,
        updatedAt,
        null,
      ),
    ]);

    const bootstrap = await worker.fetch(
      new Request("https://example.com/api/bootstrap", {
        headers: { cookie: cookie ?? "" },
      }),
      devSessionEnv,
    );

    expect(bootstrap.status).toBe(200);

    const payload = (await bootstrap.json()) as BootstrapPayload;
    expect(payload.user).toEqual({
      id: "user_dev",
      email: "dev@markean.local",
    });
    expect(payload.folders.map((folder: { id: string }) => folder.id)).toEqual(["folder_active_self_bootstrap"]);
    expect(payload.notes.map((note: { id: string }) => note.id)).toEqual(["note_active_self_bootstrap"]);
  });

  it("rejects expired sessions during bootstrap", async () => {
    await baseEnv.DB.prepare("INSERT OR REPLACE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind("user_expired", "expired@markean.local", new Date().toISOString())
      .run();
    await baseEnv.DB.prepare("INSERT OR REPLACE INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind("sess_expired", "user_expired", new Date().toISOString(), "2000-01-01T00:00:00.000Z")
      .run();

    const bootstrap = await worker.fetch(
      new Request("https://example.com/api/bootstrap", {
        headers: { cookie: "markean_session=sess_expired" },
      }),
      baseEnv,
    );

    expect(bootstrap.status).toBe(401);
  });
});

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
    const createdAt = "2026-01-01T00:00:00.000Z";
    const updatedAt = "2026-01-02T00:00:00.000Z";
    const deletedAt = "2026-01-03T00:00:00.000Z";

    await devEnv.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind("user_other", "other@example.com", createdAt)
      .run();

    await devEnv.DB.batch([
      devEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_active_b", "user_dev", "Active B", 2, 2, createdAt, updatedAt, null),
      devEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_deleted", "user_dev", "Deleted", 1, 1, createdAt, updatedAt, deletedAt),
      devEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_active_a", "user_dev", "Active A", 1, 3, createdAt, updatedAt, null),
      devEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_other_user", "user_other", "Other User", 1, 1, createdAt, updatedAt, null),
    ]);

    const response = await worker.fetch(
      new Request("https://example.com/api/folders", {
        headers: { cookie },
      }),
      devEnv,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "folder_active_a",
        name: "Active A",
        sortOrder: 1,
        currentRevision: 3,
        createdAt,
        updatedAt,
        deletedAt: null,
      },
      {
        id: "folder_active_b",
        name: "Active B",
        sortOrder: 2,
        currentRevision: 2,
        createdAt,
        updatedAt,
        deletedAt: null,
      },
    ]);
  });
});

import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";

const migrationStatements = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE notes (
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
  `CREATE TABLE sync_events (
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

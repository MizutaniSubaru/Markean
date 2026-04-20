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

    const note = await baseEnv.DB.prepare("SELECT deleted_at, current_revision FROM notes WHERE id = ?")
      .bind("n1").first<{ deleted_at: string | null; current_revision: number }>();
    expect(note!.deleted_at).toBeNull();
    expect(note!.current_revision).toBe(2);

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

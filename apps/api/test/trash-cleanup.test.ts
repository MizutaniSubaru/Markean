import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";

const migrationStatements = [
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
];

const baseEnv = env as typeof env & { DB: D1Database };
const scheduledWorker = worker as unknown as {
  scheduled: (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => Promise<void>;
};

const scheduledEvent = {
  cron: "0 3 * * *",
  scheduledTime: Date.now(),
  type: "scheduled",
} as ScheduledEvent;

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

describe("trash cleanup cron", () => {
  beforeAll(async () => {
    for (const statement of migrationStatements) {
      await baseEnv.DB.prepare(statement).run();
    }
  });

  beforeEach(async () => {
    await baseEnv.DB.prepare("DELETE FROM notes").run();
    await baseEnv.DB.prepare("DELETE FROM folders").run();
  });

  it("removes only soft-deleted records older than 30 days", async () => {
    const now = new Date();
    const createdAt = now.toISOString();
    const oldDeletedAt = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recentDeletedAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_active", "user_dev", "Active", 1, 1, createdAt, createdAt, null),
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_old_deleted", "user_dev", "Old Deleted", 2, 1, createdAt, createdAt, oldDeletedAt),
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("folder_recent_deleted", "user_dev", "Recent Deleted", 3, 1, createdAt, createdAt, recentDeletedAt),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("note_active", "user_dev", "folder_active", "Active", "body", "body", 1, createdAt, createdAt, null),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "note_old_deleted",
        "user_dev",
        "folder_old_deleted",
        "Old Deleted",
        "body",
        "body",
        1,
        createdAt,
        createdAt,
        oldDeletedAt,
      ),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "note_recent_deleted",
        "user_dev",
        "folder_recent_deleted",
        "Recent Deleted",
        "body",
        "body",
        1,
        createdAt,
        createdAt,
        recentDeletedAt,
      ),
    ]);

    await scheduledWorker.scheduled(scheduledEvent, baseEnv as unknown as Env, executionContext);

    const remainingFolders = await baseEnv.DB.prepare("SELECT id FROM folders ORDER BY id").all<{ id: string }>();
    const remainingNotes = await baseEnv.DB.prepare("SELECT id FROM notes ORDER BY id").all<{ id: string }>();

    expect(remainingFolders.results?.map((row) => row.id)).toEqual([
      "folder_active",
      "folder_recent_deleted",
    ]);
    expect(remainingNotes.results?.map((row) => row.id)).toEqual([
      "note_active",
      "note_recent_deleted",
    ]);
  });
});

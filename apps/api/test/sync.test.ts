import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";

const migrationStatements = [
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

describe("sync routes", () => {
  beforeAll(async () => {
    for (const statement of migrationStatements) {
      await baseEnv.DB.prepare(statement).run();
    }
  });

  it("pushes a note change and returns it on pull after cursor 0", async () => {
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
              payload: {
                folderId: "folder_1",
                title: "Hello",
                bodyMd: "World",
              },
            },
          ],
        }),
      }),
      baseEnv,
    );

    expect(push.status).toBe(200);

    const pull = await worker.fetch(new Request("https://example.com/api/sync/pull?cursor=0"), baseEnv);

    expect(pull.status).toBe(200);
    await expect(pull.json()).resolves.toMatchObject({
      events: [expect.objectContaining({ entityId: "note_1" })],
    });
  });
});

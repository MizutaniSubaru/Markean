import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
    current_revision INTEGER NOT NULL,
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
const devEnv = { ...baseEnv, ALLOW_DEV_SESSION: "true" };

async function getDevCookie(): Promise<string> {
  const response = await worker.fetch(
    new Request("https://example.com/api/dev/session", { method: "POST" }),
    devEnv,
  );

  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("missing dev session cookie");
  }

  return cookie;
}

async function pushSync(body: unknown, cookie?: string) {
  return worker.fetch(
    new Request("https://example.com/api/sync/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    devEnv,
  );
}

async function pullSync(cursor: number, cookie: string) {
  return worker.fetch(
    new Request(`https://example.com/api/sync/pull?cursor=${cursor}`, {
      headers: { cookie },
    }),
    devEnv,
  );
}

describe("sync routes", () => {
  let cookie: string;

  beforeAll(async () => {
    for (const statement of migrationStatements) {
      await baseEnv.DB.prepare(statement).run();
    }

    cookie = await getDevCookie();
  });

  beforeEach(async () => {
    await baseEnv.DB.prepare("DELETE FROM sync_events").run();
    await baseEnv.DB.prepare("DELETE FROM notes").run();
    await baseEnv.DB.prepare("DELETE FROM folders").run();
    await baseEnv.DB.prepare("DELETE FROM sessions").run();
    await baseEnv.DB.prepare("DELETE FROM users WHERE id != ?").bind("user_dev").run();
    cookie = await getDevCookie();
  });

  it("rejects push without auth", async () => {
    const response = await pushSync({
      deviceId: "web_1",
      changes: [],
    });

    expect(response.status).toBe(401);
  });

  it("pushes a note create and returns it on pull with entity data", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await baseEnv.DB.prepare(
      `INSERT INTO folders (
        id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
      .bind("folder_1", "user_dev", "Inbox", 1, 1, now, now)
      .run();

    const push = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_note_create",
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
      },
      cookie,
    );

    expect(push.status).toBe(200);

    const pull = await pullSync(0, cookie);
    expect(pull.status).toBe(200);
    await expect(pull.json()).resolves.toMatchObject({
      nextCursor: 1,
      events: [
        {
          cursor: 1,
          entityType: "note",
          entityId: "note_1",
          operation: "create",
          revisionNumber: 1,
          sourceDeviceId: "web_1",
          entity: {
            id: "note_1",
            folderId: "folder_1",
            title: "Hello",
            bodyMd: "World",
            bodyPlain: "World",
            currentRevision: 1,
            deletedAt: null,
          },
        },
      ],
    });
  });

  it("pushes a folder create and update", async () => {
    const createResponse = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_folder_create",
            entityType: "folder",
            entityId: "folder_1",
            operation: "create",
            baseRevision: 0,
            payload: {
              name: "Inbox",
              sortOrder: 1,
            },
          },
        ],
      },
      cookie,
    );

    expect(createResponse.status).toBe(200);

    const updateResponse = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_folder_update",
            entityType: "folder",
            entityId: "folder_1",
            operation: "update",
            baseRevision: 1,
            payload: {
              name: "Archive",
              sortOrder: 9,
            },
          },
        ],
      },
      cookie,
    );

    expect(updateResponse.status).toBe(200);

    const pull = await pullSync(0, cookie);
    await expect(pull.json()).resolves.toMatchObject({
      nextCursor: 2,
      events: [
        expect.objectContaining({
          entityType: "folder",
          entityId: "folder_1",
          operation: "create",
        }),
        expect.objectContaining({
          entityType: "folder",
          entityId: "folder_1",
          operation: "update",
          revisionNumber: 2,
          entity: expect.objectContaining({
            id: "folder_1",
            name: "Archive",
            sortOrder: 9,
            currentRevision: 2,
            deletedAt: null,
          }),
        }),
      ],
    });
  });

  it("reuses an existing D1 parent event when DO handled state is missing", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const sessionId = "sess_replay";
    const replayCookie = `markean_session=${sessionId}`;
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
      ).bind("user_replay", "replay@markean.local", now),
      baseEnv.DB.prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      ).bind(sessionId, "user_replay", now, "2026-12-31T00:00:00.000Z"),
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("folder_1", "user_replay", "Inbox", 1, 1, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("note_1", "user_replay", "folder_1", "Hello", "World", "World", 1, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO sync_events (
          id, user_id, entity_type, entity_id, operation,
          revision_number, client_change_id, source_device_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "evt_existing",
        "user_replay",
        "note",
        "note_1",
        "create",
        1,
        "chg_note_create_replay",
        "web_1",
        now,
      ),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_2",
        changes: [
          {
            clientChangeId: "chg_note_create_replay",
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
      },
      replayCookie,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: [{ acceptedRevision: 1, cursor: 1 }],
      cursor: 1,
    });

    const eventCounts = await baseEnv.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         COUNT(DISTINCT client_change_id) AS distinctClientChangeIds
       FROM sync_events
       WHERE user_id = ? AND client_change_id = ?`,
    )
      .bind("user_replay", "chg_note_create_replay")
      .first<{ total: number; distinctClientChangeIds: number }>();

    expect(eventCounts).toEqual({
      total: 1,
      distinctClientChangeIds: 1,
    });
  });

  it("detects conflicts on update", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await baseEnv.DB.prepare(
      `INSERT INTO folders (
        id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
      .bind("folder_1", "user_dev", "Inbox", 1, 2, now, now)
      .run();

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_folder_conflict",
            entityType: "folder",
            entityId: "folder_1",
            operation: "update",
            baseRevision: 1,
            payload: {
              name: "Client Name",
              sortOrder: 7,
            },
          },
        ],
      },
      cookie,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: [],
      conflicts: [
        {
          entityType: "folder",
          entityId: "folder_1",
          serverRevision: 2,
        },
      ],
    });
  });

  it("soft-deletes a note via sync push", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("folder_1", "user_dev", "Inbox", 1, 1, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("note_1", "user_dev", "folder_1", "Hello", "World", "World", 1, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_note_delete",
            entityType: "note",
            entityId: "note_1",
            operation: "delete",
            baseRevision: 1,
            payload: null,
          },
        ],
      },
      cookie,
    );

    expect(response.status).toBe(200);

    const pull = await pullSync(0, cookie);
    await expect(pull.json()).resolves.toMatchObject({
      events: [
        expect.objectContaining({
          entityType: "note",
          entityId: "note_1",
          operation: "delete",
          revisionNumber: 2,
          entity: expect.objectContaining({
            id: "note_1",
            currentRevision: 2,
          }),
        }),
      ],
    });

    const note = await baseEnv.DB.prepare(
      "SELECT deleted_at AS deletedAt, current_revision AS currentRevision FROM notes WHERE id = ?",
    )
      .bind("note_1")
      .first<{ deletedAt: string | null; currentRevision: number }>();

    expect(note?.deletedAt).not.toBeNull();
    expect(note?.currentRevision).toBe(2);
  });

  it("rejects note update when the live target row is missing and emits no sync event", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("folder_1", "user_dev", "Inbox", 1, 1, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("note_missing", "user_dev", "folder_1", "Hello", "World", "World", 1, now, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_note_update_missing",
            entityType: "note",
            entityId: "note_missing",
            operation: "update",
            baseRevision: 1,
            payload: {
              folderId: "folder_1",
              title: "Updated",
              bodyMd: "Body",
            },
          },
        ],
      },
      cookie,
    );

    expect(response.status).toBe(500);

    const eventCount = await baseEnv.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM sync_events
       WHERE user_id = ? AND client_change_id = ?`,
    )
      .bind("user_dev", "chg_note_update_missing")
      .first<{ count: number }>();

    expect(eventCount?.count).toBe(0);
  });

  it("cascade soft-deletes notes when folder is deleted", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("folder_1", "user_dev", "Inbox", 1, 1, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("note_1", "user_dev", "folder_1", "First", "One", "One", 1, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("note_2", "user_dev", "folder_1", "Second", "Two", "Two", 4, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_folder_delete",
            entityType: "folder",
            entityId: "folder_1",
            operation: "delete",
            baseRevision: 1,
            payload: null,
          },
        ],
      },
      cookie,
    );

    expect(response.status).toBe(200);

    const pull = await pullSync(0, cookie);
    const data = await pull.json() as {
      nextCursor: number;
      events: Array<{
        entityType: string;
        entityId: string;
        operation: string;
        revisionNumber: number;
        entity: Record<string, unknown> | null;
      }>;
    };

    expect(data.nextCursor).toBe(3);
    expect(data.events).toEqual([
      expect.objectContaining({
        entityType: "folder",
        entityId: "folder_1",
        operation: "delete",
        revisionNumber: 2,
        entity: expect.objectContaining({
          id: "folder_1",
          deletedAt: expect.any(String),
        }),
      }),
      expect.objectContaining({
        entityType: "note",
        entityId: "note_1",
        operation: "delete",
        revisionNumber: 2,
        entity: expect.objectContaining({
          id: "note_1",
          deletedAt: expect.any(String),
        }),
      }),
      expect.objectContaining({
        entityType: "note",
        entityId: "note_2",
        operation: "delete",
        revisionNumber: 5,
        entity: expect.objectContaining({
          id: "note_2",
          deletedAt: expect.any(String),
        }),
      }),
    ]);
  });
});

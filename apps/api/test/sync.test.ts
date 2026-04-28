import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SyncCoordinator } from "../src/durable/SyncCoordinator";
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

const baseEnv = env as typeof env & {
  DB: D1Database;
  ALLOW_DEV_SESSION: string;
  SYNC_COORDINATOR: DurableObjectNamespace<SyncCoordinator>;
};
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

  it("accepts a same-batch note create followed by update", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await baseEnv.DB.prepare(
      `INSERT INTO folders (
        id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
      .bind("folder_1", "user_dev", "Inbox", 1, 1, now, now)
      .run();

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_note_create_batch",
            entityType: "note",
            entityId: "note_batch",
            operation: "create",
            baseRevision: 0,
            payload: {
              folderId: "folder_1",
              title: "Draft",
              bodyMd: "Initial body",
            },
          },
          {
            clientChangeId: "chg_note_update_batch",
            entityType: "note",
            entityId: "note_batch",
            operation: "update",
            baseRevision: 1,
            payload: {
              folderId: "folder_1",
              title: "Published",
              bodyMd: "Updated body",
            },
          },
        ],
      },
      cookie,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      accepted: Array<{ acceptedRevision: number; cursor: number }>;
      cursor: number;
    };

    expect(body.accepted).toHaveLength(2);
    expect(body.accepted.map((accepted) => accepted.acceptedRevision)).toEqual([1, 2]);
    expect(body.cursor).toBe(body.accepted[1]?.cursor);
    expect(body.accepted[0]?.cursor).toBeLessThan(body.accepted[1]?.cursor ?? 0);

    const note = await baseEnv.DB.prepare(
      `SELECT
         folder_id AS folderId,
         title,
         body_md AS bodyMd,
         body_plain AS bodyPlain,
         current_revision AS currentRevision,
         deleted_at AS deletedAt
       FROM notes
       WHERE id = ? AND user_id = ?`,
    )
      .bind("note_batch", "user_dev")
      .first<{
        folderId: string;
        title: string;
        bodyMd: string;
        bodyPlain: string;
        currentRevision: number;
        deletedAt: string | null;
      }>();

    expect(note).toEqual({
      folderId: "folder_1",
      title: "Published",
      bodyMd: "Updated body",
      bodyPlain: "Updated body",
      currentRevision: 2,
      deletedAt: null,
    });

    const events = await baseEnv.DB.prepare(
      `SELECT
         entity_type AS entityType,
         entity_id AS entityId,
         operation,
         revision_number AS revisionNumber,
         client_change_id AS clientChangeId
       FROM sync_events
       WHERE user_id = ?
       ORDER BY cursor ASC`,
    )
      .bind("user_dev")
      .all<{
        entityType: string;
        entityId: string;
        operation: string;
        revisionNumber: number;
        clientChangeId: string;
      }>();

    expect(events.results).toEqual([
      {
        entityType: "note",
        entityId: "note_batch",
        operation: "create",
        revisionNumber: 1,
        clientChangeId: "chg_note_create_batch",
      },
      {
        entityType: "note",
        entityId: "note_batch",
        operation: "update",
        revisionNumber: 2,
        clientChangeId: "chg_note_update_batch",
      },
    ]);
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

  it("rejects a direct coordinator stale note update without mutating or writing an event", async () => {
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
      ).bind("note_1", "user_dev", "folder_1", "Server Title", "Server Body", "Server Body", 2, now, now),
    ]);

    const coordinator = baseEnv.SYNC_COORDINATOR.getByName("user_dev");
    await expect(
      runInDurableObject(coordinator, (instance) =>
        instance.applyChange({
          userId: "user_dev",
          deviceId: "web_1",
          clientChangeId: "chg_direct_stale_note_update",
          entityType: "note",
          entityId: "note_1",
          operation: "update",
          baseRevision: 1,
          payload: {
            folderId: "folder_1",
            title: "Stale Client Title",
            bodyMd: "Stale Client Body",
          },
        }),
      ),
    ).rejects.toMatchObject({
      conflicts: [
        {
          entityType: "note",
          entityId: "note_1",
          serverRevision: 2,
        },
      ],
    });

    const note = await baseEnv.DB.prepare(
      `SELECT
         title,
         body_md AS bodyMd,
         body_plain AS bodyPlain,
         current_revision AS currentRevision,
         deleted_at AS deletedAt
       FROM notes
       WHERE id = ? AND user_id = ?`,
    )
      .bind("note_1", "user_dev")
      .first<{
        title: string;
        bodyMd: string;
        bodyPlain: string;
        currentRevision: number;
        deletedAt: string | null;
      }>();

    expect(note).toEqual({
      title: "Server Title",
      bodyMd: "Server Body",
      bodyPlain: "Server Body",
      currentRevision: 2,
      deletedAt: null,
    });

    const eventCount = await baseEnv.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM sync_events
       WHERE user_id = ? AND client_change_id = ?`,
    )
      .bind("user_dev", "chg_direct_stale_note_update")
      .first<{ count: number }>();

    expect(eventCount?.count).toBe(0);
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

  it("detects conflicts on stale note delete", async () => {
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
      ).bind("note_1", "user_dev", "folder_1", "Server Title", "Server Body", "Server Body", 2, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_note_stale_delete",
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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: [],
      conflicts: [
        {
          entityType: "note",
          entityId: "note_1",
          serverRevision: 2,
        },
      ],
    });

    const note = await baseEnv.DB.prepare(
      `SELECT deleted_at AS deletedAt, current_revision AS currentRevision
       FROM notes
       WHERE id = ? AND user_id = ?`,
    )
      .bind("note_1", "user_dev")
      .first<{ deletedAt: string | null; currentRevision: number }>();

    expect(note).toEqual({
      deletedAt: null,
      currentRevision: 2,
    });

    const eventCount = await baseEnv.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM sync_events
       WHERE user_id = ? AND client_change_id = ?`,
    )
      .bind("user_dev", "chg_note_stale_delete")
      .first<{ count: number }>();

    expect(eventCount?.count).toBe(0);
  });

  it("detects conflicts on stale folder delete without cascading notes", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("folder_1", "user_dev", "Inbox", 1, 2, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("note_1", "user_dev", "folder_1", "Child", "Body", "Body", 1, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_folder_stale_delete",
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

    const folder = await baseEnv.DB.prepare(
      `SELECT deleted_at AS deletedAt, current_revision AS currentRevision
       FROM folders
       WHERE id = ? AND user_id = ?`,
    )
      .bind("folder_1", "user_dev")
      .first<{ deletedAt: string | null; currentRevision: number }>();

    expect(folder).toEqual({
      deletedAt: null,
      currentRevision: 2,
    });

    const note = await baseEnv.DB.prepare(
      `SELECT deleted_at AS deletedAt, current_revision AS currentRevision
       FROM notes
       WHERE id = ? AND user_id = ?`,
    )
      .bind("note_1", "user_dev")
      .first<{ deletedAt: string | null; currentRevision: number }>();

    expect(note).toEqual({
      deletedAt: null,
      currentRevision: 1,
    });

    const eventCount = await baseEnv.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM sync_events
       WHERE user_id = ? AND operation = 'delete'
         AND entity_id IN (?, ?)`,
    )
      .bind("user_dev", "folder_1", "note_1")
      .first<{ count: number }>();

    expect(eventCount?.count).toBe(0);
  });

  it("detects conflicts on folder delete when a child note has a newer revision", async () => {
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
      ).bind("note_1", "user_dev", "folder_1", "Server Title", "Server Body", "Server Body", 2, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_folder_delete_child_conflict",
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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: [],
      conflicts: [
        {
          entityType: "note",
          entityId: "note_1",
          serverRevision: 2,
        },
      ],
    });

    const folder = await baseEnv.DB.prepare(
      `SELECT deleted_at AS deletedAt, current_revision AS currentRevision
       FROM folders
       WHERE id = ? AND user_id = ?`,
    )
      .bind("folder_1", "user_dev")
      .first<{ deletedAt: string | null; currentRevision: number }>();

    expect(folder).toEqual({
      deletedAt: null,
      currentRevision: 1,
    });

    const note = await baseEnv.DB.prepare(
      `SELECT deleted_at AS deletedAt, current_revision AS currentRevision
       FROM notes
       WHERE id = ? AND user_id = ?`,
    )
      .bind("note_1", "user_dev")
      .first<{ deletedAt: string | null; currentRevision: number }>();

    expect(note).toEqual({
      deletedAt: null,
      currentRevision: 2,
    });

    const eventCount = await baseEnv.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM sync_events
       WHERE user_id = ? AND operation = 'delete'
         AND entity_id IN (?, ?)`,
    )
      .bind("user_dev", "folder_1", "note_1")
      .first<{ count: number }>();

    expect(eventCount?.count).toBe(0);
  });

  it("accepts folder delete after a same-batch child note delete at the current revision", async () => {
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
      ).bind("note_1", "user_dev", "folder_1", "Server Title", "Server Body", "Server Body", 2, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("note_2", "user_dev", "folder_1", "Child", "Body", "Body", 1, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_note_delete_before_folder_delete",
            entityType: "note",
            entityId: "note_1",
            operation: "delete",
            baseRevision: 2,
            payload: null,
          },
          {
            clientChangeId: "chg_folder_delete_after_child",
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
    const body = await response.json() as {
      accepted: Array<{ acceptedRevision: number; cursor: number }>;
      cursor: number;
    };

    expect(body.accepted.map((accepted) => accepted.acceptedRevision)).toEqual([3, 2]);
    expect(body.cursor).toBe(body.accepted[1]?.cursor);
    expect(body.accepted[0]?.cursor).toBeLessThan(body.accepted[1]?.cursor ?? 0);

    const events = await baseEnv.DB.prepare(
      `SELECT
         entity_type AS entityType,
         entity_id AS entityId,
         operation,
         revision_number AS revisionNumber,
         client_change_id AS clientChangeId
       FROM sync_events
       WHERE user_id = ?
       ORDER BY cursor ASC`,
    )
      .bind("user_dev")
      .all<{
        entityType: string;
        entityId: string;
        operation: string;
        revisionNumber: number;
        clientChangeId: string;
      }>();

    expect(events.results).toEqual([
      {
        entityType: "note",
        entityId: "note_1",
        operation: "delete",
        revisionNumber: 3,
        clientChangeId: "chg_note_delete_before_folder_delete",
      },
      {
        entityType: "folder",
        entityId: "folder_1",
        operation: "delete",
        revisionNumber: 2,
        clientChangeId: "chg_folder_delete_after_child",
      },
      {
        entityType: "note",
        entityId: "note_2",
        operation: "delete",
        revisionNumber: 2,
        clientChangeId: "cascade_folder_1_note_2",
      },
    ]);

    const folder = await baseEnv.DB.prepare(
      `SELECT deleted_at AS deletedAt, current_revision AS currentRevision
       FROM folders
       WHERE id = ? AND user_id = ?`,
    )
      .bind("folder_1", "user_dev")
      .first<{ deletedAt: string | null; currentRevision: number }>();

    expect(folder).toEqual({
      deletedAt: expect.any(String),
      currentRevision: 2,
    });

    const notes = await baseEnv.DB.prepare(
      `SELECT id, deleted_at AS deletedAt, current_revision AS currentRevision
       FROM notes
       WHERE user_id = ?
       ORDER BY id ASC`,
    )
      .bind("user_dev")
      .all<{ id: string; deletedAt: string | null; currentRevision: number }>();

    expect(notes.results).toEqual([
      {
        id: "note_1",
        deletedAt: expect.any(String),
        currentRevision: 3,
      },
      {
        id: "note_2",
        deletedAt: expect.any(String),
        currentRevision: 2,
      },
    ]);
  });

  it("accepts folder delete after a same-batch child note update at the current revision", async () => {
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
      ).bind("note_1", "user_dev", "folder_1", "Server Title", "Server Body", "Server Body", 2, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_note_update_before_folder_delete",
            entityType: "note",
            entityId: "note_1",
            operation: "update",
            baseRevision: 2,
            payload: {
              folderId: "folder_1",
              title: "Client Title",
              bodyMd: "Client Body",
            },
          },
          {
            clientChangeId: "chg_folder_delete_after_child_update",
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
    const body = await response.json() as {
      accepted: Array<{ acceptedRevision: number; cursor: number }>;
      cursor: number;
    };

    expect(body.accepted.map((accepted) => accepted.acceptedRevision)).toEqual([3, 2]);
    expect(body.cursor).toBe(body.accepted[1]?.cursor);
    expect(body.accepted[0]?.cursor).toBeLessThan(body.accepted[1]?.cursor ?? 0);

    const events = await baseEnv.DB.prepare(
      `SELECT
         entity_type AS entityType,
         entity_id AS entityId,
         operation,
         revision_number AS revisionNumber,
         client_change_id AS clientChangeId
       FROM sync_events
       WHERE user_id = ?
       ORDER BY cursor ASC`,
    )
      .bind("user_dev")
      .all<{
        entityType: string;
        entityId: string;
        operation: string;
        revisionNumber: number;
        clientChangeId: string;
      }>();

    expect(events.results).toEqual([
      {
        entityType: "note",
        entityId: "note_1",
        operation: "update",
        revisionNumber: 3,
        clientChangeId: "chg_note_update_before_folder_delete",
      },
      {
        entityType: "folder",
        entityId: "folder_1",
        operation: "delete",
        revisionNumber: 2,
        clientChangeId: "chg_folder_delete_after_child_update",
      },
      {
        entityType: "note",
        entityId: "note_1",
        operation: "delete",
        revisionNumber: 4,
        clientChangeId: "cascade_folder_1_note_1",
      },
    ]);

    const note = await baseEnv.DB.prepare(
      `SELECT
         title,
         body_md AS bodyMd,
         body_plain AS bodyPlain,
         deleted_at AS deletedAt,
         current_revision AS currentRevision
       FROM notes
       WHERE id = ? AND user_id = ?`,
    )
      .bind("note_1", "user_dev")
      .first<{
        title: string;
        bodyMd: string;
        bodyPlain: string;
        deletedAt: string | null;
        currentRevision: number;
      }>();

    expect(note).toEqual({
      title: "Client Title",
      bodyMd: "Client Body",
      bodyPlain: "Client Body",
      deletedAt: expect.any(String),
      currentRevision: 4,
    });
  });

  it("rejects folder delete before a later child note update without partial mutation", async () => {
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
      ).bind("note_1", "user_dev", "folder_1", "Original", "Original Body", "Original Body", 1, now, now),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_folder_delete_before_child_update",
            entityType: "folder",
            entityId: "folder_1",
            operation: "delete",
            baseRevision: 1,
            payload: null,
          },
          {
            clientChangeId: "chg_child_update_after_folder_delete",
            entityType: "note",
            entityId: "note_1",
            operation: "update",
            baseRevision: 1,
            payload: {
              folderId: "folder_1",
              title: "Updated Too Late",
              bodyMd: "Updated Body",
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
          entityType: "note",
          entityId: "note_1",
          serverRevision: 1,
        },
      ],
    });

    const folder = await baseEnv.DB.prepare(
      `SELECT deleted_at AS deletedAt, current_revision AS currentRevision
       FROM folders
       WHERE id = ? AND user_id = ?`,
    )
      .bind("folder_1", "user_dev")
      .first<{ deletedAt: string | null; currentRevision: number }>();

    expect(folder).toEqual({
      deletedAt: null,
      currentRevision: 1,
    });

    const note = await baseEnv.DB.prepare(
      `SELECT
         title,
         body_md AS bodyMd,
         deleted_at AS deletedAt,
         current_revision AS currentRevision
       FROM notes
       WHERE id = ? AND user_id = ?`,
    )
      .bind("note_1", "user_dev")
      .first<{
        title: string;
        bodyMd: string;
        deletedAt: string | null;
        currentRevision: number;
      }>();

    expect(note).toEqual({
      title: "Original",
      bodyMd: "Original Body",
      deletedAt: null,
      currentRevision: 1,
    });

    const eventCount = await baseEnv.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM sync_events
       WHERE user_id = ? AND client_change_id IN (?, ?)`,
    )
      .bind(
        "user_dev",
        "chg_folder_delete_before_child_update",
        "chg_child_update_after_folder_delete",
      )
      .first<{ count: number }>();

    expect(eventCount?.count).toBe(0);
  });

  it("uses an existing accepted child note update as handled when retrying folder delete", async () => {
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
      ).bind("note_1", "user_dev", "folder_1", "Already Updated", "Current Body", "Current Body", 3, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO sync_events (
          id, user_id, entity_type, entity_id, operation,
          revision_number, client_change_id, source_device_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "evt_existing_note_update_retry",
        "user_dev",
        "note",
        "note_1",
        "update",
        3,
        "chg_existing_note_update_before_folder_delete",
        "web_1",
        now,
      ),
    ]);

    const response = await pushSync(
      {
        deviceId: "web_1",
        changes: [
          {
            clientChangeId: "chg_existing_note_update_before_folder_delete",
            entityType: "note",
            entityId: "note_1",
            operation: "update",
            baseRevision: 2,
            payload: {
              folderId: "folder_1",
              title: "Already Updated",
              bodyMd: "Current Body",
            },
          },
          {
            clientChangeId: "chg_folder_delete_after_existing_child_update",
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
    const body = await response.json() as {
      accepted: Array<{ acceptedRevision: number; cursor: number }>;
      cursor: number;
    };

    expect(body.accepted.map((accepted) => accepted.acceptedRevision)).toEqual([3, 2]);

    const events = await baseEnv.DB.prepare(
      `SELECT
         entity_type AS entityType,
         entity_id AS entityId,
         operation,
         revision_number AS revisionNumber,
         client_change_id AS clientChangeId
       FROM sync_events
       WHERE user_id = ?
       ORDER BY cursor ASC`,
    )
      .bind("user_dev")
      .all<{
        entityType: string;
        entityId: string;
        operation: string;
        revisionNumber: number;
        clientChangeId: string;
      }>();

    expect(events.results).toEqual([
      {
        entityType: "note",
        entityId: "note_1",
        operation: "update",
        revisionNumber: 3,
        clientChangeId: "chg_existing_note_update_before_folder_delete",
      },
      {
        entityType: "folder",
        entityId: "folder_1",
        operation: "delete",
        revisionNumber: 2,
        clientChangeId: "chg_folder_delete_after_existing_child_update",
      },
      {
        entityType: "note",
        entityId: "note_1",
        operation: "delete",
        revisionNumber: 4,
        clientChangeId: "cascade_folder_1_note_1",
      },
    ]);
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

  it("returns the accepted result for an idempotent note delete retry", async () => {
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

    const body = {
      deviceId: "web_1",
      changes: [
        {
          clientChangeId: "chg_note_delete_retry",
          entityType: "note",
          entityId: "note_1",
          operation: "delete",
          baseRevision: 1,
          payload: null,
        },
      ],
    };

    const firstResponse = await pushSync(body, cookie);
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json() as {
      accepted: Array<{ acceptedRevision: number; cursor: number }>;
      cursor: number;
    };

    const retryResponse = await pushSync(body, cookie);
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toEqual(firstBody);

    const eventCount = await baseEnv.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM sync_events
       WHERE user_id = ? AND client_change_id = ?`,
    )
      .bind("user_dev", "chg_note_delete_retry")
      .first<{ count: number }>();

    expect(eventCount?.count).toBe(1);
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
      ).bind("note_2", "user_dev", "folder_1", "Second", "Two", "Two", 1, now, now),
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
        revisionNumber: 2,
        entity: expect.objectContaining({
          id: "note_2",
          deletedAt: expect.any(String),
        }),
      }),
    ]);
  });

  it("returns the accepted result for an idempotent folder delete retry with cascade", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT INTO folders (
          id, user_id, name, sort_order, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("folder_retry", "user_dev", "Inbox", 1, 1, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("note_retry_1", "user_dev", "folder_retry", "First", "One", "One", 1, now, now),
      baseEnv.DB.prepare(
        `INSERT INTO notes (
          id, user_id, folder_id, title, body_md, body_plain, current_revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind("note_retry_2", "user_dev", "folder_retry", "Second", "Two", "Two", 1, now, now),
    ]);

    const body = {
      deviceId: "web_1",
      changes: [
        {
          clientChangeId: "chg_folder_delete_retry",
          entityType: "folder",
          entityId: "folder_retry",
          operation: "delete",
          baseRevision: 1,
          payload: null,
        },
      ],
    };

    const firstResponse = await pushSync(body, cookie);
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json() as {
      accepted: Array<{ acceptedRevision: number; cursor: number }>;
      cursor: number;
    };

    const retryResponse = await pushSync(body, cookie);
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toEqual(firstBody);

    const eventCounts = await baseEnv.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN client_change_id = ? THEN 1 ELSE 0 END) AS folderDeletes,
         SUM(CASE WHEN client_change_id LIKE ? THEN 1 ELSE 0 END) AS cascadeDeletes
       FROM sync_events
       WHERE user_id = ? AND entity_id IN (?, ?, ?)`,
    )
      .bind(
        "chg_folder_delete_retry",
        "cascade_folder_retry_%",
        "user_dev",
        "folder_retry",
        "note_retry_1",
        "note_retry_2",
      )
      .first<{ total: number; folderDeletes: number; cascadeDeletes: number }>();

    expect(eventCounts).toEqual({
      total: 3,
      folderDeletes: 1,
      cascadeDeletes: 2,
    });
  });
});

import { Hono } from "hono";
import type { Env } from "../env";
import { getDb } from "../lib/db";
import { listSyncEventsByUserIdAfterCursor } from "../lib/repos/sync-events";
import type { SyncChangeInput } from "../durable/SyncCoordinator";

const DEV_USER_ID = "user_dev";

export const syncRoutes = new Hono<{ Bindings: Env }>()
  .post("/api/sync/push", async (c) => {
    const body = (await c.req.json()) as {
      deviceId: string;
      changes: Array<Omit<SyncChangeInput, "userId" | "deviceId">>;
    };

    const db = getDb(c.env);
    const conflicts = [];

    for (const change of body.changes) {
      const currentNote = await db
        .prepare(
          `SELECT current_revision AS currentRevision
           FROM notes
           WHERE id = ?`,
        )
        .bind(change.entityId)
        .first<{ currentRevision: number }>();

      const serverRevision = currentNote?.currentRevision ?? 0;
      if (serverRevision > change.baseRevision) {
        conflicts.push({
          entityId: change.entityId,
          serverRevision,
          localTitle: change.payload.title,
          localBodyMd: change.payload.bodyMd,
        });
      }
    }

    if (conflicts.length > 0) {
      return c.json(
        {
          accepted: [],
          conflicts,
        },
        409,
      );
    }

    const coordinator = c.env.SYNC_COORDINATOR.getByName(DEV_USER_ID);
    const accepted = [];

    for (const change of body.changes) {
      accepted.push(
        await coordinator.applyChange({
          ...change,
          userId: DEV_USER_ID,
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
    const events = await listSyncEventsByUserIdAfterCursor(getDb(c.env), DEV_USER_ID, cursor);

    return c.json({
      nextCursor: events.at(-1)?.cursor ?? cursor,
      events,
    });
  });

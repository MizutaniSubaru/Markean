import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { listSyncEventsWithEntities } from "../lib/repos/sync-events";
import type { SyncChangeInput } from "../durable/SyncCoordinator";

type PushBody = {
  deviceId: string;
  changes: Array<Omit<SyncChangeInput, "userId" | "deviceId">>;
};

export const syncRoutes = new Hono<AuthEnv>()
  .use("/api/sync/*", requireAuth)
  .post("/api/sync/push", async (c) => {
    const body = (await c.req.json()) as PushBody;
    const userId = c.get("userId");
    const db = getDb(c.env);
    const conflicts: Array<{
      entityType: SyncChangeInput["entityType"];
      entityId: string;
      serverRevision: number;
    }> = [];

    for (const change of body.changes) {
      if (change.operation !== "update") continue;

      const table = change.entityType === "note" ? "notes" : "folders";
      const currentNote = await db
        .prepare(
          `SELECT current_revision AS currentRevision
           FROM ${table}
           WHERE id = ? AND user_id = ?`,
        )
        .bind(change.entityId, userId)
        .first<{ currentRevision: number }>();

      const serverRevision = currentNote?.currentRevision ?? 0;
      if (serverRevision > change.baseRevision) {
        conflicts.push({
          entityType: change.entityType,
          entityId: change.entityId,
          serverRevision,
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

    const coordinator = c.env.SYNC_COORDINATOR.getByName(userId);
    const accepted = [];

    for (const change of body.changes) {
      accepted.push(
        await coordinator.applyChange({
          ...change,
          userId,
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
    const userId = c.get("userId");
    const events = await listSyncEventsWithEntities(getDb(c.env), userId, cursor);

    return c.json({
      nextCursor: events.at(-1)?.cursor ?? cursor,
      events,
    });
  });

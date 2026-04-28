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
    let hasMissingUpdateTarget = false;

    for (const change of body.changes) {
      if (change.operation !== "update" && change.operation !== "delete") continue;

      const existingAcceptedChange = await db
        .prepare(
          `SELECT 1 AS found
           FROM sync_events
           WHERE user_id = ?
             AND client_change_id = ?
             AND entity_type = ?
             AND entity_id = ?
             AND operation = ?
           LIMIT 1`,
        )
        .bind(
          userId,
          change.clientChangeId,
          change.entityType,
          change.entityId,
          change.operation,
        )
        .first<{ found: number }>();

      if (existingAcceptedChange) continue;

      const table = change.entityType === "note" ? "notes" : "folders";
      const currentEntity = await db
        .prepare(
          `SELECT
             current_revision AS currentRevision,
             deleted_at AS deletedAt
           FROM ${table}
           WHERE id = ? AND user_id = ?`,
        )
        .bind(change.entityId, userId)
        .first<{ currentRevision: number; deletedAt: string | null }>();

      const serverRevision = currentEntity?.currentRevision ?? 0;
      if (serverRevision > change.baseRevision) {
        conflicts.push({
          entityType: change.entityType,
          entityId: change.entityId,
          serverRevision,
        });
        continue;
      }

      if (change.operation === "update" && (!currentEntity || currentEntity.deletedAt !== null)) {
        hasMissingUpdateTarget = true;
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

    if (hasMissingUpdateTarget) {
      return c.json({ error: "sync_push_failed" }, 500);
    }

    const coordinator = c.env.SYNC_COORDINATOR.getByName(userId);
    const accepted = [];

    try {
      for (const change of body.changes) {
        accepted.push(
          await coordinator.applyChange({
            ...change,
            userId,
            deviceId: body.deviceId,
          }),
        );
      }
    } catch (error) {
      console.error(error);
      return c.json({ error: "sync_push_failed" }, 500);
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

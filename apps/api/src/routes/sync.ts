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
    const coordinator = c.env.SYNC_COORDINATOR.getByName(userId);

    try {
      const result = await coordinator.applyChanges(
        body.changes.map((change) => ({
          ...change,
          userId,
          deviceId: body.deviceId,
        })),
      );

      if (!result.ok) {
        if ("error" in result) {
          return c.json({ error: result.error }, 500);
        }

        return c.json(
          {
            accepted: [],
            conflicts: result.conflicts,
          },
          409,
        );
      }

      return c.json({
        accepted: result.accepted,
        cursor: result.cursor,
      });
    } catch (error) {
      console.error(error);
      return c.json({ error: "sync_push_failed" }, 500);
    }
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

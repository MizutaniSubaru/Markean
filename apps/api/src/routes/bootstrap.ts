import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { listActiveFoldersByUserId } from "../lib/repos/folders";
import { listActiveNotesByUserId, getLatestSyncCursorForUser } from "../lib/repos/notes";

export const bootstrapRoutes = new Hono<AuthEnv>()
  .use("/api/bootstrap", requireAuth)
  .get("/api/bootstrap", async (c) => {
    const db = getDb(c.env);
    const userId = c.get("userId");

    const [folders, notes, syncCursor] = await Promise.all([
      listActiveFoldersByUserId(db, userId),
      listActiveNotesByUserId(db, userId),
      getLatestSyncCursorForUser(db, userId),
    ]);

    return c.json({
      user: { id: userId, email: c.get("userEmail") },
      folders,
      notes,
      syncCursor,
    });
  });

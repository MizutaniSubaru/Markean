import { Hono } from "hono";
import type { Env } from "../env";
import { getDb } from "../lib/db";
import { listFoldersByUserId } from "../lib/repos/folders";
import { getLatestSyncCursorForUser, listNotesByUserId } from "../lib/repos/notes";
import { getSessionIdFromCookie, getUserForSessionCookieValue } from "../lib/repos/sessions";

export const bootstrapRoutes = new Hono<{ Bindings: Env }>().get("/api/bootstrap", async (c) => {
  const sessionCookieValue = getSessionIdFromCookie(c.req.header("cookie"));

  if (!sessionCookieValue) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const db = getDb(c.env);
  const user = await getUserForSessionCookieValue(db, sessionCookieValue);

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const [folders, notes, syncCursor] = await Promise.all([
    listFoldersByUserId(db, user.id),
    listNotesByUserId(db, user.id),
    getLatestSyncCursorForUser(db, user.id),
  ]);

  return c.json({
    user,
    folders,
    notes,
    syncCursor,
  });
});

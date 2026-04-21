import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { listActiveNotesByUserId, listDeletedNotesByUserId, restoreNote } from "../lib/repos/notes";

export const noteRoutes = new Hono<AuthEnv>()
  .use("/api/notes/*", requireAuth)
  .use("/api/notes", requireAuth)
  .get("/api/notes", async (c) => {
    const notes = await listActiveNotesByUserId(getDb(c.env), c.get("userId"));
    return c.json(notes);
  })
  .get("/api/notes/trash", async (c) => {
    const notes = await listDeletedNotesByUserId(getDb(c.env), c.get("userId"));
    return c.json(notes);
  })
  .post("/api/notes/:id/restore", async (c) => {
    const noteId = c.req.param("id");
    const result = await restoreNote(getDb(c.env), c.get("userId"), noteId);
    if (!result) {
      return c.json({ error: "Note not found or not deleted" }, 404);
    }
    return c.json(result);
  });

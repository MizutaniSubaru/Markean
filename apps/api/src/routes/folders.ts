import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { listActiveFoldersByUserId } from "../lib/repos/folders";

export const folderRoutes = new Hono<AuthEnv>()
  .use("/api/folders/*", requireAuth)
  .use("/api/folders", requireAuth)
  .get("/api/folders", async (c) => {
    const folders = await listActiveFoldersByUserId(getDb(c.env), c.get("userId"));
    return c.json(folders);
  });

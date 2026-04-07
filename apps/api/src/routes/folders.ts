import { Hono } from "hono";
import type { Env } from "../env";

export const folderRoutes = new Hono<{ Bindings: Env }>()
  .get("/api/folders", (c) => c.json([]))
  .post("/api/folders", async (c) => c.json(await c.req.json(), 201));

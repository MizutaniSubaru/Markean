import { Hono } from "hono";
import type { Env } from "../env";

export const noteRoutes = new Hono<{ Bindings: Env }>()
  .get("/api/notes", (c) => c.json([]))
  .post("/api/notes", async (c) => c.json(await c.req.json(), 201));

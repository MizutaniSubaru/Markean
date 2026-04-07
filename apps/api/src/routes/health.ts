import { Hono } from "hono";
import type { Env } from "../env";

export const healthRoutes = new Hono<{ Bindings: Env }>().get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "markean-api",
    timestamp: new Date().toISOString(),
  });
});

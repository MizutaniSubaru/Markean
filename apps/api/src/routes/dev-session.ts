import { Hono } from "hono";
import { getDb } from "../lib/db";
import { createDevSession, sessionCookieName } from "../lib/repos/sessions";
import type { Env } from "../env";

export const devSessionRoutes = new Hono<{ Bindings: Env }>().post("/api/dev/session", async (c) => {
  if (c.env.ALLOW_DEV_SESSION !== "true") {
    return c.notFound();
  }

  const { sessionId, userId } = await createDevSession(getDb(c.env));

  c.header("set-cookie", `${sessionCookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
  return c.json({ ok: true, userId });
});

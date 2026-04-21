import { createMiddleware } from "hono/factory";
import { getDb } from "../lib/db";
import { getSessionIdFromCookie, getUserForSessionCookieValue } from "../lib/repos/sessions";
import type { Env } from "../env";

type AuthVariables = {
  userId: string;
  userEmail: string;
};

export type AuthEnv = {
  Bindings: Env;
  Variables: AuthVariables;
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const cookieValue = getSessionIdFromCookie(c.req.header("cookie"));
  if (!cookieValue) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const user = await getUserForSessionCookieValue(getDb(c.env), cookieValue);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", user.id);
  c.set("userEmail", user.email);
  await next();
});

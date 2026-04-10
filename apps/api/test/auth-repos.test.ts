import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createSession, getSessionByToken } from "../src/lib/repos/sessions";
import { allowEmail, isEmailAllowed } from "../src/lib/repos/beta-allowed-emails";
import { createMagicLinkToken, consumeMagicLinkToken } from "../src/lib/repos/magic-link-tokens";

const db = (env as typeof env & { DB: D1Database }).DB;

describe("auth repositories", () => {
  beforeAll(async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS beta_allowed_emails (email TEXT PRIMARY KEY, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, token_hash TEXT, client_type TEXT NOT NULL DEFAULT 'web', revoked_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS magic_link_tokens (id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, client_type TEXT NOT NULL, redirect_target TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)").run();
  });

  it("stores hashed session tokens and enforces single-use magic links", async () => {
    await db.prepare("INSERT OR REPLACE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind("user_1", "user_1@example.com", new Date().toISOString())
      .run();

    await allowEmail(db, "beta@example.com");
    expect(await isEmailAllowed(db, "beta@example.com")).toBe(true);

    const session = await createSession(db, {
      userId: "user_1",
      clientType: "mobile",
      ttlMs: 3_600_000,
    });
    expect(session.token).toMatch(/^ms_/);

    const loaded = await getSessionByToken(db, session.token);
    expect(loaded).toMatchObject({ userId: "user_1", clientType: "mobile" });

    const magicLink = await createMagicLinkToken(db, {
      email: "beta@example.com",
      clientType: "web",
      redirectTarget: "/",
      ttlMs: 1_200_000,
    });
    expect(await consumeMagicLinkToken(db, magicLink.token)).toMatchObject({
      email: "beta@example.com",
      clientType: "web",
    });
    await expect(consumeMagicLinkToken(db, magicLink.token)).resolves.toBeNull();
  });
});

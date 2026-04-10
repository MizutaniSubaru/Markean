import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { hashOpaqueToken } from "../src/lib/auth/crypto";
import { createAuthCode, consumeAuthCode } from "../src/lib/repos/auth-codes";
import { getAuthAccountByProviderSubject, upsertAuthAccount } from "../src/lib/repos/auth-accounts";
import { createSession, getSessionByToken } from "../src/lib/repos/sessions";
import { allowEmail, isEmailAllowed } from "../src/lib/repos/beta-allowed-emails";
import { createMagicLinkToken, consumeMagicLinkToken } from "../src/lib/repos/magic-link-tokens";

const db = (env as typeof env & { DB: D1Database }).DB;

describe("auth repositories", () => {
  beforeAll(async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, provider_subject TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider, provider_subject))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS auth_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS beta_allowed_emails (email TEXT PRIMARY KEY, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, token_hash TEXT, client_type TEXT NOT NULL DEFAULT 'web', revoked_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS magic_link_tokens (id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, client_type TEXT NOT NULL, redirect_target TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)").run();
  });

  it("stores hashed session tokens at rest", async () => {
    const userId = `user_${crypto.randomUUID()}`;
    await db.prepare("INSERT OR REPLACE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userId, `${userId}@example.com`, new Date().toISOString())
      .run();

    await allowEmail(db, "beta@example.com");
    expect(await isEmailAllowed(db, "beta@example.com")).toBe(true);

    const session = await createSession(db, {
      userId,
      clientType: "mobile",
      ttlMs: 3_600_000,
    });
    expect(session.token).toMatch(/^ms_/);

    const stored = await db.prepare("SELECT token_hash FROM sessions WHERE id = ?").bind(session.id).first<{ token_hash: string }>();
    expect(stored?.token_hash).toBeTruthy();
    expect(stored?.token_hash).not.toBe(session.token);
    expect(stored?.token_hash).toBe(await hashOpaqueToken(session.token));

    const loaded = await getSessionByToken(db, session.token);
    expect(loaded).toMatchObject({ userId, clientType: "mobile" });
  });

  it("stores magic link tokens at rest and consumes them once", async () => {
    const magicLink = await createMagicLinkToken(db, {
      email: "beta@example.com",
      clientType: "web",
      redirectTarget: "/",
      ttlMs: 1_200_000,
    });

    const stored = await db
      .prepare("SELECT token_hash FROM magic_link_tokens WHERE id = ?")
      .bind(magicLink.id)
      .first<{ token_hash: string }>();
    expect(stored?.token_hash).toBeTruthy();
    expect(stored?.token_hash).not.toBe(magicLink.token);
    expect(stored?.token_hash).toBe(await hashOpaqueToken(magicLink.token));

    const [first, second] = await Promise.all([consumeMagicLinkToken(db, magicLink.token), consumeMagicLinkToken(db, magicLink.token)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    await expect(consumeMagicLinkToken(db, magicLink.token)).resolves.toBeNull();
  });

  it("stores auth codes at rest and consumes them once", async () => {
    const code = await createAuthCode(db, {
      userId: "user_1",
      provider: "magic_link",
      ttlMs: 1_200_000,
    });

    const stored = await db
      .prepare("SELECT code_hash FROM auth_codes WHERE id = ?")
      .bind(code.id)
      .first<{ code_hash: string }>();
    expect(stored?.code_hash).toBeTruthy();
    expect(stored?.code_hash).not.toBe(code.value);
    expect(stored?.code_hash).toBe(await hashOpaqueToken(code.value));

    const [first, second] = await Promise.all([consumeAuthCode(db, code.value), consumeAuthCode(db, code.value)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    await expect(consumeAuthCode(db, code.value)).resolves.toBeNull();
  });

  it("keeps auth account identity bound to the original user", async () => {
    const provider = "google" as const;
    const providerSubject = `subject_${crypto.randomUUID()}`;
    const userA = `user_${crypto.randomUUID()}`;
    const userB = `user_${crypto.randomUUID()}`;

    await db.prepare("INSERT OR REPLACE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userA, `${userA}@example.com`, new Date().toISOString())
      .run();
    await db.prepare("INSERT OR REPLACE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userB, `${userB}@example.com`, new Date().toISOString())
      .run();

    const created = await upsertAuthAccount(db, {
      userId: userA,
      provider,
      providerSubject,
      email: "first@example.com",
      emailVerified: false,
    });
    expect(created).toMatchObject({ userId: userA, provider, providerSubject, email: "first@example.com", emailVerified: false });

    const updated = await upsertAuthAccount(db, {
      userId: userB,
      provider,
      providerSubject,
      email: "second@example.com",
      emailVerified: true,
    });
    expect(updated).toMatchObject({ userId: userA, provider, providerSubject, email: "second@example.com", emailVerified: true });

    const loaded = await getAuthAccountByProviderSubject(db, provider, providerSubject);
    expect(loaded).toMatchObject({ userId: userA, provider, providerSubject, email: "second@example.com", emailVerified: true });
  });
});

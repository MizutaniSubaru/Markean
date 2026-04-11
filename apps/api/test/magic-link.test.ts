import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashOpaqueToken } from "../src/lib/auth/crypto";
import { allowEmail } from "../src/lib/repos/beta-allowed-emails";
import worker from "../src/index";

const db = (env as typeof env & { DB: D1Database }).DB;

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    token_hash TEXT,
    client_type TEXT NOT NULL DEFAULT 'web',
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS beta_allowed_emails (
    email TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS magic_link_tokens (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    client_type TEXT NOT NULL,
    redirect_target TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  )`,
];

const baseEnv = {
  ...env,
  APP_ENV: "dev",
  APP_BASE_URL: "http://127.0.0.1:4173",
  API_BASE_URL: "https://api.markean.test",
  MAGIC_LINK_SECRET: "magic-secret",
  MAGIC_LINK_TTL_MINUTES: "20",
  EMAIL_FROM: "Markean <login@mizutani.top>",
  RESEND_API_KEY: "re_test_123",
} as typeof env & {
  DB: D1Database;
  APP_ENV: "dev";
  APP_BASE_URL: string;
  API_BASE_URL: string;
  MAGIC_LINK_SECRET: string;
  MAGIC_LINK_TTL_MINUTES: string;
  EMAIL_FROM: string;
  RESEND_API_KEY: string;
};

const approvedEmail = "beta@example.com";

function extractUrl(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  return value.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;
}

describe("magic-link auth routes", () => {
  beforeAll(async () => {
    for (const statement of migrationStatements) {
      await db.prepare(statement).run();
    }
  });

  beforeEach(async () => {
    await db.prepare("DELETE FROM users").run();
    await db.prepare("DELETE FROM sessions").run();
    await db.prepare("DELETE FROM beta_allowed_emails").run();
    await db.prepare("DELETE FROM magic_link_tokens").run();
    await db.prepare("DELETE FROM auth_codes").run();
    await allowEmail(db, approvedEmail);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects unapproved emails with a stable 403 payload", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/auth/email/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "blocked@example.com",
          clientType: "web",
          redirectTarget: "/welcome",
        }),
      }),
      baseEnv,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "beta_access_denied",
      message: "Email is not approved for this beta",
    });
  });

  it("sends a magic link for approved web users and creates a session on verify", async () => {
    const resendRequests: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      resendRequests.push({
        url: typeof input === "string" || input instanceof URL ? input.toString() : input.url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null,
      });

      return new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const requestResponse = await worker.fetch(
      new Request("https://example.com/api/auth/email/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "  BETA@example.com  ",
          clientType: "web",
          redirectTarget: "/welcome?ref=email",
        }),
      }),
      baseEnv,
    );

    expect(requestResponse.status).toBe(202);
    await expect(requestResponse.json()).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resendRequests[0]?.url).toBe("https://api.resend.com/emails");

    const resendBody = resendRequests[0]?.body as {
      from?: string;
      to?: string;
      subject?: string;
      html?: string;
      text?: string;
    };
    expect(resendBody).toMatchObject({
      from: "Markean <login@mizutani.top>",
      to: approvedEmail,
    });

    const verificationUrl = extractUrl([resendBody?.text, resendBody?.html].find((value) =>
      value?.includes("/api/auth/email/verify?token="),
    ));
    expect(verificationUrl).toBeTruthy();
    expect(new URL(verificationUrl ?? "").origin).toBe(baseEnv.API_BASE_URL);

    const token = new URL(verificationUrl ?? "").searchParams.get("token");
    expect(token).toBeTruthy();

    const tokenRow = await db
      .prepare(
        "SELECT email, token_hash AS tokenHash, client_type AS clientType, redirect_target AS redirectTarget FROM magic_link_tokens LIMIT 1",
      )
      .first<{ email: string; tokenHash: string; clientType: "web"; redirectTarget: string }>();

    expect(tokenRow).toMatchObject({
      email: approvedEmail,
      clientType: "web",
      redirectTarget: "/welcome?ref=email",
    });
    expect(tokenRow?.tokenHash).toBe(await hashOpaqueToken(token ?? ""));

    const verifyResponse = await worker.fetch(new Request(verificationUrl ?? ""), baseEnv);

    expect(verifyResponse.status).toBe(302);
    expect(verifyResponse.headers.get("location")).toBe(`${baseEnv.APP_BASE_URL}/welcome?ref=email`);

    const cookie = verifyResponse.headers.get("set-cookie");
    expect(cookie).toContain("markean_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const sessionToken = cookie?.match(/markean_session=([^;]+)/)?.[1];
    expect(sessionToken).toBeTruthy();

    const sessionRow = await db
      .prepare(
        "SELECT user_id AS userId, token_hash AS tokenHash, client_type AS clientType FROM sessions LIMIT 1",
      )
      .first<{ userId: string; tokenHash: string; clientType: "web" }>();

    expect(sessionRow).toMatchObject({
      clientType: "web",
    });
    expect(sessionRow?.tokenHash).toBe(await hashOpaqueToken(sessionToken ?? ""));

    const userRow = await db
      .prepare("SELECT email FROM users WHERE email = ?")
      .bind(approvedEmail)
      .first<{ email: string }>();
    expect(userRow).toMatchObject({ email: approvedEmail });
  });

  it("creates a mobile auth code and appends it safely to the redirect target", async () => {
    const resendRequests: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      resendRequests.push({
        url: typeof input === "string" || input instanceof URL ? input.toString() : input.url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null,
      });

      return new Response(JSON.stringify({ id: "email_456" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const requestResponse = await worker.fetch(
      new Request("https://example.com/api/auth/email/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: approvedEmail,
          clientType: "mobile",
          redirectTarget: "myapp://auth/finish?source=mail",
        }),
      }),
      baseEnv,
    );

    expect(requestResponse.status).toBe(202);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestPayload = resendRequests[0]?.body as {
      html?: string;
      text?: string;
    };
    const mobileVerificationUrl = extractUrl(
      [requestPayload.text, requestPayload.html].find((value) =>
        value?.includes("/api/auth/email/verify?token="),
      ),
    );
    expect(mobileVerificationUrl).toBeTruthy();
    expect(new URL(mobileVerificationUrl ?? "").origin).toBe(baseEnv.API_BASE_URL);

    const token = new URL(mobileVerificationUrl ?? "").searchParams.get("token");
    expect(token).toBeTruthy();

    const tokenRow = await db
      .prepare(
        "SELECT email, token_hash AS tokenHash, client_type AS clientType, redirect_target AS redirectTarget FROM magic_link_tokens LIMIT 1",
      )
      .first<{ email: string; tokenHash: string; clientType: "mobile"; redirectTarget: string }>();

    expect(tokenRow).toMatchObject({
      email: approvedEmail,
      clientType: "mobile",
      redirectTarget: "myapp://auth/finish?source=mail",
    });
    expect(tokenRow?.tokenHash).toBe(await hashOpaqueToken(token ?? ""));

    const verifyResponse = await worker.fetch(new Request(mobileVerificationUrl ?? ""), baseEnv);

    expect(verifyResponse.status).toBe(302);
    expect(verifyResponse.headers.get("set-cookie")).toBeNull();

    const redirectLocation = verifyResponse.headers.get("location");
    expect(redirectLocation).toContain("myapp://auth/finish?source=mail");
    expect(redirectLocation).toContain("code=");

    const code = new URL(redirectLocation ?? "").searchParams.get("code");
    expect(code).toBeTruthy();

    const authCodeRow = await db
      .prepare(
        "SELECT user_id AS userId, code_hash AS codeHash, provider FROM auth_codes LIMIT 1",
      )
      .first<{ userId: string; codeHash: string; provider: "magic_link" }>();
    expect(authCodeRow).toMatchObject({
      provider: "magic_link",
    });
    expect(authCodeRow?.codeHash).toBe(await hashOpaqueToken(code ?? ""));
  });
});

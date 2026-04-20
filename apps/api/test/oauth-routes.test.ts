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
  `CREATE TABLE IF NOT EXISTS auth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    email TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, provider_subject)
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
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    current_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    client_change_id TEXT NOT NULL,
    source_device_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

const applePrivateKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgpekIEi39gUIRd4ef
UOz/vXne9x8p0ohgLHEWtbIFdemhRANCAATmlVMUyRh7zQujDv7DowWSrdSMD7St
wsdA5nNJOvj7oFj56buKKIfpcB5Wh6jfpmfhb4PhghVDwyf2jG75rk0g
-----END PRIVATE KEY-----`;

const baseEnv = {
  ...env,
  APP_ENV: "dev",
  APP_BASE_URL: "http://127.0.0.1:4173",
  API_BASE_URL: "https://api.markean.test",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  APPLE_CLIENT_ID: "apple-client-id",
  APPLE_TEAM_ID: "apple-team-id",
  APPLE_KEY_ID: "apple-key-id",
  APPLE_PRIVATE_KEY: applePrivateKey,
  MAGIC_LINK_SECRET: "magic-secret",
  MAGIC_LINK_TTL_MINUTES: "20",
  EMAIL_FROM: "Markean <login@mizutani.top>",
  RESEND_API_KEY: "re_test_123",
} as typeof env & {
  DB: D1Database;
  APP_ENV: "dev";
  APP_BASE_URL: string;
  API_BASE_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APPLE_CLIENT_ID: string;
  APPLE_TEAM_ID: string;
  APPLE_KEY_ID: string;
  APPLE_PRIVATE_KEY: string;
  MAGIC_LINK_SECRET: string;
  MAGIC_LINK_TTL_MINUTES: string;
  EMAIL_FROM: string;
  RESEND_API_KEY: string;
};

const approvedEmail = "beta@example.com";
const googleSubject = "google-sub-123";
const appleSubject = "apple-sub-123";

function getLocation(response: Response) {
  return response.headers.get("location") ?? "";
}

function decodeState(state: string) {
  return JSON.parse(
    atob(state.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (state.length % 4)) % 4)),
  ) as { provider: string; clientType: "web" | "mobile"; redirectTarget: string };
}

function encodeBase64UrlJson(value: unknown) {
  const json = JSON.stringify(value);
  return btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("oauth auth routes", () => {
  beforeAll(async () => {
    for (const statement of migrationStatements) {
      await db.prepare(statement).run();
    }
  });

  beforeEach(async () => {
    await db.prepare("DELETE FROM users").run();
    await db.prepare("DELETE FROM sessions").run();
    await db.prepare("DELETE FROM beta_allowed_emails").run();
    await db.prepare("DELETE FROM auth_accounts").run();
    await db.prepare("DELETE FROM auth_codes").run();
    await db.prepare("DELETE FROM folders").run();
    await db.prepare("DELETE FROM notes").run();
    await db.prepare("DELETE FROM sync_events").run();
    await allowEmail(db, approvedEmail);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects Google start requests to the Google authorize URL", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/auth/google/start?clientType=web&redirectTarget=%2Fwelcome%3Ffrom%3Doauth"),
      baseEnv,
    );

    expect(response.status).toBe(302);
    const url = new URL(getLocation(response));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe(baseEnv.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${baseEnv.API_BASE_URL}/api/auth/google/callback`,
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(decodeState(url.searchParams.get("state") ?? "")).toMatchObject({
      provider: "google",
      clientType: "web",
      redirectTarget: "/welcome?from=oauth",
    });
  });

  it("creates a usable web session from the Google callback", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "google-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer google-access-token",
        });
        return new Response(
          JSON.stringify({
            sub: googleSubject,
            email: approvedEmail,
            email_verified: true,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const start = await worker.fetch(
      new Request("https://example.com/api/auth/google/start?clientType=web&redirectTarget=%2Fdashboard"),
      baseEnv,
    );
    const state = new URL(getLocation(start)).searchParams.get("state") ?? "";

    const callback = await worker.fetch(
      new Request(
        `https://example.com/api/auth/google/callback?code=google-code-123&state=${encodeURIComponent(state)}`,
      ),
      baseEnv,
    );

    expect(callback.status).toBe(302);
    expect(getLocation(callback)).toBe(`${baseEnv.APP_BASE_URL}/dashboard`);

    const cookie = callback.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("markean_session=");
    expect(cookie).toContain("HttpOnly");

    const bootstrap = await worker.fetch(
      new Request("https://example.com/api/bootstrap", {
        headers: { cookie },
      }),
      baseEnv,
    );

    expect(bootstrap.status).toBe(200);
    await expect(bootstrap.json()).resolves.toMatchObject({
      user: { email: approvedEmail },
    });
  });

  it("reuses the canonical linked Google user when the callback email changes", async () => {
    const linkedUserId = "user_linked_google";
    const linkedEmail = "linked-google@example.com";
    const updatedEmail = "linked-google-new@example.com";

    await allowEmail(db, updatedEmail);
    await db
      .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(linkedUserId, linkedEmail, new Date().toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO auth_accounts (id, user_id, provider, provider_subject, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "aa_linked_google",
        linkedUserId,
        "google",
        googleSubject,
        linkedEmail,
        1,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;

        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(JSON.stringify({ access_token: "google-access-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
          expect(init?.headers).toMatchObject({
            authorization: "Bearer google-access-token",
          });
          return new Response(
            JSON.stringify({
              sub: googleSubject,
              email: updatedEmail,
              email_verified: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    const start = await worker.fetch(
      new Request("https://example.com/api/auth/google/start?clientType=web&redirectTarget=%2Fdashboard"),
      baseEnv,
    );
    const state = new URL(getLocation(start)).searchParams.get("state") ?? "";

    const callback = await worker.fetch(
      new Request(
        `https://example.com/api/auth/google/callback?code=google-code-123&state=${encodeURIComponent(state)}`,
      ),
      baseEnv,
    );

    expect(callback.status).toBe(302);

    const sessionRow = await db
      .prepare("SELECT user_id AS userId FROM sessions WHERE client_type = ? ORDER BY created_at DESC LIMIT 1")
      .bind("web")
      .first<{ userId: string }>();
    expect(sessionRow?.userId).toBe(linkedUserId);

    const accountRow = await db
      .prepare("SELECT user_id AS userId, email FROM auth_accounts WHERE provider = ? AND provider_subject = ?")
      .bind("google", googleSubject)
      .first<{ userId: string; email: string }>();
    expect(accountRow).toMatchObject({
      userId: linkedUserId,
      email: updatedEmail,
    });
  });

  it("redirects Apple start requests to Sign in with Apple", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/auth/apple/start?clientType=mobile&redirectTarget=myapp%3A%2F%2Fauth"),
      baseEnv,
    );

    expect(response.status).toBe(302);
    const url = new URL(getLocation(response));
    expect(url.origin).toBe("https://appleid.apple.com");
    expect(url.searchParams.get("client_id")).toBe(baseEnv.APPLE_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
    expect(url.searchParams.get("scope")).toBe("email");
    expect(decodeState(url.searchParams.get("state") ?? "")).toMatchObject({
      provider: "apple",
      clientType: "mobile",
      redirectTarget: "myapp://auth",
    });
  });

  it("reuses the canonical linked Apple user when the callback email changes", async () => {
    const linkedUserId = "user_linked_apple";
    const linkedEmail = "linked-apple@example.com";
    const updatedEmail = "linked-apple-new@example.com";

    await allowEmail(db, updatedEmail);
    await db
      .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(linkedUserId, linkedEmail, new Date().toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO auth_accounts (id, user_id, provider, provider_subject, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "aa_linked_apple",
        linkedUserId,
        "apple",
        appleSubject,
        linkedEmail,
        1,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;

        if (url === "https://appleid.apple.com/auth/token") {
          return new Response(
            JSON.stringify({
              id_token: [
                "eyJhbGciOiJFUzI1NiIsImtpZCI6ImV4YW1wbGUiLCJ0eXAiOiJKV1QifQ",
                encodeBase64UrlJson({
                  sub: appleSubject,
                  email: updatedEmail,
                  email_verified: "true",
                }),
                "signature",
              ].join("."),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    const start = await worker.fetch(
      new Request("https://example.com/api/auth/apple/start?clientType=mobile&redirectTarget=myapp%3A%2F%2Fauth"),
      baseEnv,
    );
    const state = new URL(getLocation(start)).searchParams.get("state") ?? "";

    const callback = await worker.fetch(
      new Request("https://example.com/api/auth/apple/callback", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: "apple-code-123",
          state,
        }).toString(),
      }),
      baseEnv,
    );

    expect(callback.status).toBe(302);

    const authCodeRow = await db
      .prepare("SELECT user_id AS userId FROM auth_codes WHERE provider = ? ORDER BY created_at DESC LIMIT 1")
      .bind("apple")
      .first<{ userId: string }>();
    expect(authCodeRow?.userId).toBe(linkedUserId);

    const accountRow = await db
      .prepare("SELECT user_id AS userId, email FROM auth_accounts WHERE provider = ? AND provider_subject = ?")
      .bind("apple", appleSubject)
      .first<{ userId: string; email: string }>();
    expect(accountRow).toMatchObject({
      userId: linkedUserId,
      email: updatedEmail,
    });
  });

  it("returns a deep-link auth code from the Apple callback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;

        if (url === "https://appleid.apple.com/auth/token") {
          return new Response(
            JSON.stringify({
              id_token: [
                "eyJhbGciOiJFUzI1NiIsImtpZCI6ImV4YW1wbGUiLCJ0eXAiOiJKV1QifQ",
                "eyJzdWIiOiJhcHBsZS1zdWItMTIzIiwiZW1haWwiOiJiZXRhQGV4YW1wbGUuY29tIiwiZW1haWxfdmVyaWZpZWQiOiJ0cnVlIn0",
                "signature",
              ].join("."),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    const start = await worker.fetch(
      new Request("https://example.com/api/auth/apple/start?clientType=mobile&redirectTarget=myapp%3A%2F%2Fauth"),
      baseEnv,
    );
    const state = new URL(getLocation(start)).searchParams.get("state") ?? "";

    const callback = await worker.fetch(
      new Request("https://example.com/api/auth/apple/callback", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: "apple-code-123",
          state,
        }).toString(),
      }),
      baseEnv,
    );

    expect(callback.status).toBe(302);
    const location = getLocation(callback);
    expect(location.startsWith("myapp://auth?code=")).toBe(true);

    const code = new URL(location).searchParams.get("code") ?? "";
    expect(code).toMatch(/^ac_/);
  });

  it("rejects Google callbacks when the email is not beta approved", async () => {
    await db.prepare("DELETE FROM beta_allowed_emails").run();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;

        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(JSON.stringify({ access_token: "google-access-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
          return new Response(
            JSON.stringify({
              sub: googleSubject,
              email: "blocked@example.com",
              email_verified: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    const start = await worker.fetch(
      new Request("https://example.com/api/auth/google/start?clientType=web&redirectTarget=%2Fdashboard"),
      baseEnv,
    );
    const state = new URL(getLocation(start)).searchParams.get("state") ?? "";

    const callback = await worker.fetch(
      new Request(
        `https://example.com/api/auth/google/callback?code=google-code-123&state=${encodeURIComponent(state)}`,
      ),
      baseEnv,
    );

    expect(callback.status).toBe(403);
    await expect(callback.json()).resolves.toMatchObject({
      code: "beta_access_denied",
      message: "Email is not approved for this beta",
    });
  });
});

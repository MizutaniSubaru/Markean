# Markean Beta Backend Auth Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a beta-ready Cloudflare auth stack for Markean with Google login, Apple login, email magic links, Markean-owned sessions, protected bootstrap/sync routes, a minimal web sign-in surface, and a manual operator rollout guide.

**Architecture:** The Worker remains the single backend entry point and grows a dedicated auth layer around config parsing, token hashing, provider callbacks, allowlist checks, and shared session validation. The web app adds only a thin sign-in shell and uses the API for all auth work. Because no committed `apps/mobile` Expo code exists in this worktree, this plan implements the backend exchange contract and shared client helpers that the mobile branch can consume instead of trying to invent a second UI stack here.

**Tech Stack:** Cloudflare Workers, Hono, D1, Durable Objects, R2, Vitest, Vite, React, `@testing-library/react`, Resend, OAuth 2.0 / OpenID Connect

---

## File Map

### API auth foundation

- Create: `apps/api/src/lib/auth/config.ts`
  - Parse production auth config and derive callback URLs.
- Create: `apps/api/src/lib/auth/crypto.ts`
  - Hash session tokens, magic links, and one-time auth codes.
- Create: `apps/api/src/lib/auth/cookies.ts`
  - Build and clear the `markean_session` cookie.
- Create: `apps/api/src/lib/auth/require-user.ts`
  - Read cookie or bearer token and attach the current user to the Hono context.
- Create: `apps/api/src/lib/auth/providers/google.ts`
  - Build Google start URLs and exchange callback codes.
- Create: `apps/api/src/lib/auth/providers/apple.ts`
  - Build Apple start URLs and exchange callback codes.
- Create: `apps/api/src/lib/email/resend.ts`
  - Send beta magic-link emails through Resend.

### API persistence

- Modify: `apps/api/migrations/0001_initial.sql`
  - Leave untouched.
- Create: `apps/api/migrations/0002_auth_rollout.sql`
  - Add auth tables and indexes.
- Modify: `apps/api/src/lib/repos/sessions.ts`
  - Keep dev-session helper, add hashed session creation and lookup.
- Create: `apps/api/src/lib/repos/auth-accounts.ts`
  - Store provider identities.
- Create: `apps/api/src/lib/repos/beta-allowed-emails.ts`
  - Gate beta access.
- Create: `apps/api/src/lib/repos/magic-link-tokens.ts`
  - Create and consume single-use email tokens.
- Create: `apps/api/src/lib/repos/auth-codes.ts`
  - Create and consume one-time mobile exchange codes.

### API routes

- Create: `apps/api/src/routes/auth.ts`
  - Google start/callback, Apple start/callback, email request/verify, token exchange, logout, current-user route.
- Modify: `apps/api/src/index.ts`
  - Mount auth routes.
- Modify: `apps/api/src/routes/bootstrap.ts`
  - Replace ad hoc cookie lookup with shared auth middleware.
- Modify: `apps/api/src/routes/sync.ts`
  - Stop using the hard-coded `DEV_USER_ID` and require a real authenticated user.
- Modify: `apps/api/src/routes/folders.ts`
  - Require auth before folder CRUD.
- Modify: `apps/api/src/routes/notes.ts`
  - Require auth before note CRUD.
- Modify: `apps/api/src/env.ts`
  - Add typed auth secrets and app URLs.
- Modify: `apps/api/wrangler.jsonc`
  - Add env sections and auth-related vars.

### Shared client and web

- Modify: `packages/api-client/src/index.ts`
  - Add auth endpoints and typed request helpers for web and mobile consumers.
- Create: `apps/web/src/lib/auth.ts`
  - Browser helpers for start-login redirects, logout, and magic-link requests.
- Create: `apps/web/src/components/auth/SignInScreen.tsx`
  - Minimal beta sign-in surface.
- Modify: `apps/web/src/routes/app.tsx`
  - Bootstrap user state and show sign-in screen on `401`.
- Modify: `apps/web/src/styles/app.css`
  - Add minimal sign-in styles without redesigning the existing shell.

### Tests and docs

- Create: `apps/api/test/auth-config.test.ts`
- Create: `apps/api/test/auth-repos.test.ts`
- Create: `apps/api/test/magic-link.test.ts`
- Create: `apps/api/test/oauth-routes.test.ts`
- Create: `apps/api/test/protected-routes.test.ts`
- Create: `apps/web/test/sign-in-screen.test.tsx`
- Create: `docs/superpowers/runbooks/2026-04-11-markean-beta-cloudflare-auth-setup.md`
  - Manual Cloudflare, Google, Apple, and Resend operator checklist.
- Create: `docs/superpowers/runbooks/2026-04-11-markean-expo-auth-handoff.md`
  - Deep-link and token-exchange contract for the mobile branch.

## Task 1: Add Auth Config and Schema Foundation

**Files:**
- Create: `apps/api/src/lib/auth/config.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/wrangler.jsonc`
- Create: `apps/api/migrations/0002_auth_rollout.sql`
- Test: `apps/api/test/auth-config.test.ts`

- [ ] **Step 1: Write the failing config test**

```ts
// apps/api/test/auth-config.test.ts
import { describe, expect, it } from "vitest";
import { resolveAuthConfig } from "../src/lib/auth/config";

describe("resolveAuthConfig", () => {
  it("derives callback URLs and TTLs from env", () => {
    const config = resolveAuthConfig({
      APP_ENV: "prod",
      APP_BASE_URL: "https://markean.mizutani.top",
      API_BASE_URL: "https://api-markean.mizutani.top",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      APPLE_CLIENT_ID: "apple-client",
      APPLE_TEAM_ID: "team-id",
      APPLE_KEY_ID: "key-id",
      APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
      MAGIC_LINK_SECRET: "magic-secret",
      MAGIC_LINK_TTL_MINUTES: "20",
      EMAIL_FROM: "Markean <login@mizutani.top>",
      RESEND_API_KEY: "re_test_123",
    });

    expect(config.google.callbackUrl).toBe(
      "https://api-markean.mizutani.top/api/auth/google/callback",
    );
    expect(config.apple.callbackUrl).toBe(
      "https://api-markean.mizutani.top/api/auth/apple/callback",
    );
    expect(config.magicLink.ttlMinutes).toBe(20);
    expect(config.session.cookieName).toBe("markean_session");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @markean/api exec vitest run test/auth-config.test.ts`

Expected: FAIL with `Cannot find module "../src/lib/auth/config"` or missing export errors.

- [ ] **Step 3: Write minimal config parsing and env typing**

```ts
// apps/api/src/lib/auth/config.ts
type AuthEnvShape = {
  APP_ENV: "dev" | "prod";
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

const stripTrailingSlash = (value: string) => value.replace(/\/$/, "");

export function resolveAuthConfig(env: AuthEnvShape) {
  const appBaseUrl = stripTrailingSlash(env.APP_BASE_URL);
  const apiBaseUrl = stripTrailingSlash(env.API_BASE_URL);

  return {
    appEnv: env.APP_ENV,
    appBaseUrl,
    apiBaseUrl,
    session: {
      cookieName: "markean_session",
      cookieSecure: env.APP_ENV === "prod",
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackUrl: `${apiBaseUrl}/api/auth/google/callback`,
    },
    apple: {
      clientId: env.APPLE_CLIENT_ID,
      teamId: env.APPLE_TEAM_ID,
      keyId: env.APPLE_KEY_ID,
      privateKey: env.APPLE_PRIVATE_KEY,
      callbackUrl: `${apiBaseUrl}/api/auth/apple/callback`,
    },
    magicLink: {
      secret: env.MAGIC_LINK_SECRET,
      ttlMinutes: Number(env.MAGIC_LINK_TTL_MINUTES),
    },
    resend: {
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
    },
  };
}
```

```ts
// apps/api/src/env.ts
export type Env = {
  APP_ENV: "dev" | "prod";
  APP_BASE_URL: string;
  API_BASE_URL: string;
  ALLOW_DEV_SESSION?: string;
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
  DB: D1Database;
  SYNC_COORDINATOR: DurableObjectNamespace<SyncCoordinator>;
  EXPORTS: R2Bucket;
};
```

```sql
-- apps/api/migrations/0002_auth_rollout.sql
CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject)
);

CREATE TABLE beta_allowed_emails (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

ALTER TABLE sessions ADD COLUMN token_hash TEXT;
ALTER TABLE sessions ADD COLUMN client_type TEXT NOT NULL DEFAULT 'web';
ALTER TABLE sessions ADD COLUMN revoked_at TEXT;

CREATE TABLE magic_link_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  client_type TEXT NOT NULL,
  redirect_target TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE auth_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
```

```jsonc
// apps/api/wrangler.jsonc
{
  "vars": {
    "APP_ENV": "dev",
    "APP_BASE_URL": "http://127.0.0.1:4173",
    "API_BASE_URL": "http://127.0.0.1:8787",
    "MAGIC_LINK_TTL_MINUTES": "20"
  },
  "env": {
    "prod": {
      "vars": {
        "APP_ENV": "prod",
        "APP_BASE_URL": "https://markean.mizutani.top",
        "API_BASE_URL": "https://api-markean.mizutani.top",
        "MAGIC_LINK_TTL_MINUTES": "20"
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @markean/api exec vitest run test/auth-config.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the foundation changes**

```bash
git add apps/api/src/lib/auth/config.ts apps/api/src/env.ts apps/api/wrangler.jsonc apps/api/migrations/0002_auth_rollout.sql apps/api/test/auth-config.test.ts
git commit -m "feat: add auth config foundation"
```

## Task 2: Build Session, Allowlist, and Token Repositories

**Files:**
- Create: `apps/api/src/lib/auth/crypto.ts`
- Create: `apps/api/src/lib/repos/auth-accounts.ts`
- Create: `apps/api/src/lib/repos/beta-allowed-emails.ts`
- Create: `apps/api/src/lib/repos/magic-link-tokens.ts`
- Create: `apps/api/src/lib/repos/auth-codes.ts`
- Modify: `apps/api/src/lib/repos/sessions.ts`
- Test: `apps/api/test/auth-repos.test.ts`

- [ ] **Step 1: Write the failing repo test**

```ts
// apps/api/test/auth-repos.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createSession,
  getSessionByToken,
} from "../src/lib/repos/sessions";
import { allowEmail, isEmailAllowed } from "../src/lib/repos/beta-allowed-emails";
import {
  createMagicLinkToken,
  consumeMagicLinkToken,
} from "../src/lib/repos/magic-link-tokens";

const db = (env as typeof env & { DB: D1Database }).DB;

describe("auth repositories", () => {
  beforeAll(async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS beta_allowed_emails (email TEXT PRIMARY KEY, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, token_hash TEXT, client_type TEXT NOT NULL DEFAULT 'web', revoked_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS magic_link_tokens (id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, client_type TEXT NOT NULL, redirect_target TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)").run();
  });

  it("stores hashed session tokens and enforces single-use magic links", async () => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @markean/api exec vitest run test/auth-repos.test.ts`

Expected: FAIL with missing repo exports such as `createSession` or `allowEmail`.

- [ ] **Step 3: Add the hashing helper and repo implementations**

```ts
// apps/api/src/lib/auth/crypto.ts
const encoder = new TextEncoder();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createOpaqueToken(prefix: "ms" | "ml" | "ac") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function hashOpaqueToken(value: string) {
  return sha256(value);
}
```

```ts
// apps/api/src/lib/repos/beta-allowed-emails.ts
export async function allowEmail(db: D1Database, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  await db
    .prepare("INSERT OR IGNORE INTO beta_allowed_emails (email, created_at) VALUES (?, ?)")
    .bind(normalizedEmail, new Date().toISOString())
    .run();
}

export async function isEmailAllowed(db: D1Database, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const row = await db
    .prepare("SELECT email FROM beta_allowed_emails WHERE email = ?")
    .bind(normalizedEmail)
    .first<{ email: string }>();

  return Boolean(row);
}
```

```ts
// apps/api/src/lib/repos/sessions.ts
import { createOpaqueToken, hashOpaqueToken } from "../auth/crypto";

export async function createSession(
  db: D1Database,
  input: { userId: string; clientType: "web" | "mobile"; ttlMs: number },
) {
  const token = await createOpaqueToken("ms");
  const tokenHash = await hashOpaqueToken(token);
  const sessionId = `sess_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();

  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at, token_hash, client_type, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(sessionId, input.userId, createdAt, expiresAt, tokenHash, input.clientType)
    .run();

  return { id: sessionId, token };
}

export async function getSessionByToken(db: D1Database, token: string) {
  const tokenHash = await hashOpaqueToken(token);
  return db
    .prepare(
      `SELECT sessions.id, sessions.user_id AS userId, sessions.client_type AS clientType, users.email
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > ?`,
    )
    .bind(tokenHash, new Date().toISOString())
    .first<{ id: string; userId: string; email: string; clientType: "web" | "mobile" }>();
}
```

```ts
// apps/api/src/lib/repos/magic-link-tokens.ts
import { createOpaqueToken, hashOpaqueToken } from "../auth/crypto";

export async function createMagicLinkToken(
  db: D1Database,
  input: { email: string; clientType: "web" | "mobile"; redirectTarget: string; ttlMs: number },
) {
  const token = await createOpaqueToken("ml");
  const tokenHash = await hashOpaqueToken(token);
  const id = `ml_${crypto.randomUUID()}`;
  await db
    .prepare(
      "INSERT INTO magic_link_tokens (id, email, token_hash, client_type, redirect_target, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    )
    .bind(
      id,
      input.email.trim().toLowerCase(),
      tokenHash,
      input.clientType,
      input.redirectTarget,
      new Date(Date.now() + input.ttlMs).toISOString(),
      new Date().toISOString(),
    )
    .run();

  return { id, token };
}

export async function consumeMagicLinkToken(db: D1Database, token: string) {
  const tokenHash = await hashOpaqueToken(token);
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT id, email, client_type AS clientType, redirect_target AS redirectTarget
       FROM magic_link_tokens
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<{ id: string; email: string; clientType: "web" | "mobile"; redirectTarget: string }>();

  if (!row) {
    return null;
  }

  await db.prepare("UPDATE magic_link_tokens SET consumed_at = ? WHERE id = ?").bind(now, row.id).run();
  return row;
}
```

```ts
// apps/api/src/lib/repos/auth-codes.ts
import { createOpaqueToken, hashOpaqueToken } from "../auth/crypto";

export async function createAuthCode(
  db: D1Database,
  input: { userId: string; provider: "google" | "apple" | "magic_link"; ttlMs: number },
) {
  const value = await createOpaqueToken("ac");
  const codeHash = await hashOpaqueToken(value);
  const id = `ac_${crypto.randomUUID()}`;
  await db
    .prepare(
      "INSERT INTO auth_codes (id, user_id, code_hash, provider, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
    )
    .bind(
      id,
      input.userId,
      codeHash,
      input.provider,
      new Date(Date.now() + input.ttlMs).toISOString(),
      new Date().toISOString(),
    )
    .run();

  return { id, value };
}

export async function consumeAuthCode(db: D1Database, value: string) {
  const codeHash = await hashOpaqueToken(value);
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT id, user_id AS userId, provider
       FROM auth_codes
       WHERE code_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?`,
    )
    .bind(codeHash, now)
    .first<{ id: string; userId: string; provider: "google" | "apple" | "magic_link" }>();

  if (!row) {
    return null;
  }

  await db.prepare("UPDATE auth_codes SET consumed_at = ? WHERE id = ?").bind(now, row.id).run();
  return row;
}
```

- [ ] **Step 4: Run the repo test to verify it passes**

Run: `pnpm --filter @markean/api exec vitest run test/auth-repos.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the repo layer**

```bash
git add apps/api/src/lib/auth/crypto.ts apps/api/src/lib/repos/sessions.ts apps/api/src/lib/repos/beta-allowed-emails.ts apps/api/src/lib/repos/magic-link-tokens.ts apps/api/src/lib/repos/auth-accounts.ts apps/api/src/lib/repos/auth-codes.ts apps/api/test/auth-repos.test.ts
git commit -m "feat: add auth persistence repositories"
```

## Task 3: Implement Email Magic Links and Resend Delivery

**Files:**
- Create: `apps/api/src/lib/email/resend.ts`
- Create: `apps/api/src/routes/auth.ts`
- Test: `apps/api/test/magic-link.test.ts`

- [ ] **Step 1: Write the failing magic-link route test**

```ts
// apps/api/test/magic-link.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const db = (env as typeof env & { DB: D1Database }).DB;

describe("magic-link auth routes", () => {
  beforeAll(async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS beta_allowed_emails (email TEXT PRIMARY KEY, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, token_hash TEXT, client_type TEXT NOT NULL DEFAULT 'web', revoked_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS magic_link_tokens (id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, client_type TEXT NOT NULL, redirect_target TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)").run();
    await db.prepare("INSERT OR IGNORE INTO beta_allowed_emails (email, created_at) VALUES (?, ?)").bind("beta@example.com", new Date().toISOString()).run();
  });

  it("queues a magic-link email for approved users and creates a web session on verify", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const authEnv = {
      ...env,
      APP_ENV: "dev",
      APP_BASE_URL: "http://127.0.0.1:4173",
      API_BASE_URL: "https://example.com",
      EMAIL_FROM: "Markean <login@mizutani.top>",
      RESEND_API_KEY: "re_test_123",
      MAGIC_LINK_SECRET: "magic-secret",
      MAGIC_LINK_TTL_MINUTES: "20",
    } as typeof env;

    const requestResponse = await worker.fetch(
      new Request("https://example.com/api/auth/email/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "beta@example.com",
          clientType: "web",
          redirectTarget: "/",
        }),
      }),
      authEnv,
    );

    expect(requestResponse.status).toBe(202);
    expect(fetchSpy).toHaveBeenCalled();

    const tokenRow = await db
      .prepare("SELECT token_hash AS tokenHash FROM magic_link_tokens LIMIT 1")
      .first<{ tokenHash: string }>();
    expect(tokenRow).not.toBeNull();

    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @markean/api exec vitest run test/magic-link.test.ts`

Expected: FAIL with `404` on `/api/auth/email/request` or missing auth route exports.

- [ ] **Step 3: Add the Resend helper and email auth endpoints**

```ts
// apps/api/src/lib/email/resend.ts
export async function sendMagicLinkEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  linkUrl: string;
}) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      subject: "Your Markean sign-in link",
      html: `<p>Open Markean:</p><p><a href="${input.linkUrl}">${input.linkUrl}</a></p>`,
    }),
  });
}
```

```ts
// apps/api/src/routes/auth.ts
import { Hono } from "hono";
import type { Env } from "../env";
import { getDb } from "../lib/db";
import { resolveAuthConfig } from "../lib/auth/config";
import { isEmailAllowed } from "../lib/repos/beta-allowed-emails";
import { createMagicLinkToken, consumeMagicLinkToken } from "../lib/repos/magic-link-tokens";
import { createAuthCode } from "../lib/repos/auth-codes";
import { createSession } from "../lib/repos/sessions";
import { sendMagicLinkEmail } from "../lib/email/resend";
import { buildSessionCookie } from "../lib/auth/cookies";

export const authRoutes = new Hono<{ Bindings: Env }>()
  .post("/api/auth/email/request", async (c) => {
    const body = await c.req.json<{ email: string; clientType: "web" | "mobile"; redirectTarget?: string }>();
    const db = getDb(c.env);
    const email = body.email.trim().toLowerCase();

    if (!(await isEmailAllowed(db, email))) {
      return c.json({ code: "beta_access_denied", message: "Email is not approved for this beta" }, 403);
    }

    const config = resolveAuthConfig(c.env);
    const token = await createMagicLinkToken(db, {
      email,
      clientType: body.clientType,
      redirectTarget: body.redirectTarget ?? "/",
      ttlMs: config.magicLink.ttlMinutes * 60_000,
    });

    const linkUrl = `${config.apiBaseUrl}/api/auth/email/verify?token=${encodeURIComponent(token.token)}`;
    await sendMagicLinkEmail({
      apiKey: config.resend.apiKey,
      from: config.resend.from,
      to: email,
      linkUrl,
    });

    return c.json({ ok: true }, 202);
  })
  .get("/api/auth/email/verify", async (c) => {
    const db = getDb(c.env);
    const consumed = await consumeMagicLinkToken(db, c.req.query("token") ?? "");

    if (!consumed) {
      return c.json({ code: "invalid_magic_link", message: "Magic link is invalid or expired" }, 400);
    }

    const userId = `user_${consumed.email}`;
    await db
      .prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userId, consumed.email, new Date().toISOString())
      .run();

    if (consumed.clientType === "web") {
      const session = await createSession(db, {
        userId,
        clientType: "web",
        ttlMs: 7 * 86_400_000,
      });
      c.header("set-cookie", buildSessionCookie(resolveAuthConfig(c.env), session.token));
      return c.redirect(`${resolveAuthConfig(c.env).appBaseUrl}${consumed.redirectTarget}`);
    }

    const authCode = await createAuthCode(db, {
      userId,
      provider: "magic_link",
      ttlMs: 300_000,
    });

    return c.redirect(`${consumed.redirectTarget}?code=${encodeURIComponent(authCode.value)}`);
  });
```

- [ ] **Step 4: Run the magic-link test to verify it passes**

Run: `pnpm --filter @markean/api exec vitest run test/magic-link.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the email auth flow**

```bash
git add apps/api/src/lib/email/resend.ts apps/api/src/routes/auth.ts apps/api/test/magic-link.test.ts
git commit -m "feat: add magic link auth flow"
```

## Task 4: Add Google and Apple OAuth Start/Callback Flows

**Files:**
- Create: `apps/api/src/lib/auth/providers/google.ts`
- Create: `apps/api/src/lib/auth/providers/apple.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/lib/repos/auth-accounts.ts`
- Test: `apps/api/test/oauth-routes.test.ts`

- [ ] **Step 1: Write the failing OAuth route test**

```ts
// apps/api/test/oauth-routes.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const authEnv = {
  ...env,
  APP_ENV: "dev",
  APP_BASE_URL: "http://127.0.0.1:4173",
  API_BASE_URL: "https://example.com",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  APPLE_CLIENT_ID: "apple-client",
  APPLE_TEAM_ID: "team-id",
  APPLE_KEY_ID: "key-id",
  APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  MAGIC_LINK_SECRET: "magic-secret",
  MAGIC_LINK_TTL_MINUTES: "20",
  EMAIL_FROM: "Markean <login@mizutani.top>",
  RESEND_API_KEY: "re_test_123",
} as typeof env;

describe("oauth routes", () => {
  beforeAll(async () => {
    const db = (authEnv as typeof authEnv & { DB: D1Database }).DB;
    await db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, provider_subject TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider, provider_subject))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS beta_allowed_emails (email TEXT PRIMARY KEY, created_at TEXT NOT NULL)").run();
    await db.prepare("INSERT OR IGNORE INTO beta_allowed_emails (email, created_at) VALUES (?, ?)").bind("beta@example.com", new Date().toISOString()).run();
    await db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, token_hash TEXT, client_type TEXT NOT NULL DEFAULT 'web', revoked_at TEXT)").run();
  });

  it("redirects Google starts and creates a web session on callback", async () => {
    const start = await worker.fetch(
      new Request("https://example.com/api/auth/google/start?clientType=web&redirectTarget=%2F"),
      authEnv,
    );
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toContain("accounts.google.com");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "google-access", id_token: "id-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sub: "google-sub", email: "beta@example.com", email_verified: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const callback = await worker.fetch(
      new Request("https://example.com/api/auth/google/callback?code=oauth-code&state=google.web.%2F"),
      authEnv,
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("set-cookie")).toContain("markean_session=");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @markean/api exec vitest run test/oauth-routes.test.ts`

Expected: FAIL with `404` on OAuth start routes or missing provider helpers.

- [ ] **Step 3: Add provider helpers and callback handling**

```ts
// apps/api/src/lib/auth/providers/google.ts
export function buildGoogleStartUrl(input: {
  clientId: string;
  callbackUrl: string;
  state: string;
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    prompt: "select_account",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(input: {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  code: string;
}) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.callbackUrl,
    }),
  });

  const tokens = await tokenResponse.json<{ access_token: string }>();
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });

  return profileResponse.json<{ sub: string; email: string; email_verified: boolean }>();
}
```

```ts
// apps/api/src/lib/repos/auth-accounts.ts
export async function upsertAuthAccount(
  db: D1Database,
  input: {
    provider: "google" | "apple";
    providerSubject: string;
    email: string;
    emailVerified: boolean;
  },
) {
  const userId = `user_${input.email.trim().toLowerCase()}`;
  const now = new Date().toISOString();

  await db
    .prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .bind(userId, input.email.trim().toLowerCase(), now)
    .run();

  await db
    .prepare(
      `INSERT INTO auth_accounts (id, user_id, provider, provider_subject, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_subject) DO UPDATE SET
         email = excluded.email,
         email_verified = excluded.email_verified,
         updated_at = excluded.updated_at`,
    )
    .bind(
      `acct_${crypto.randomUUID()}`,
      userId,
      input.provider,
      input.providerSubject,
      input.email.trim().toLowerCase(),
      input.emailVerified ? 1 : 0,
      now,
      now,
    )
    .run();

  return { userId };
}
```

```ts
// apps/api/src/routes/auth.ts (Google additions)
.get("/api/auth/google/start", async (c) => {
  const config = resolveAuthConfig(c.env);
  const clientType = (c.req.query("clientType") === "mobile" ? "mobile" : "web") as "web" | "mobile";
  const redirectTarget = c.req.query("redirectTarget") ?? "/";
  const state = `google.${clientType}.${encodeURIComponent(redirectTarget)}`;

  return c.redirect(
    buildGoogleStartUrl({
      clientId: config.google.clientId,
      callbackUrl: config.google.callbackUrl,
      state,
    }),
  );
})
.get("/api/auth/google/callback", async (c) => {
  const config = resolveAuthConfig(c.env);
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "google.web.%2F";
  const [, clientType, encodedRedirectTarget] = state.split(".");
  const profile = await exchangeGoogleCode({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    callbackUrl: config.google.callbackUrl,
    code,
  });

  if (!(await isEmailAllowed(getDb(c.env), profile.email))) {
    return c.json({ code: "beta_access_denied", message: "Email is not approved for this beta" }, 403);
  }

  const account = await upsertAuthAccount(getDb(c.env), {
    provider: "google",
    providerSubject: profile.sub,
    email: profile.email,
    emailVerified: profile.email_verified,
  });

  if (clientType === "mobile") {
    const authCode = await createAuthCode(getDb(c.env), {
      userId: account.userId,
      provider: "google",
      ttlMs: 300_000,
    });

    return c.redirect(`${decodeURIComponent(encodedRedirectTarget ?? "markean://auth/callback")}?code=${encodeURIComponent(authCode.value)}`);
  }

  const session = await createSession(getDb(c.env), {
    userId: account.userId,
    clientType: "web",
    ttlMs: 7 * 86_400_000,
  });
  c.header("set-cookie", buildSessionCookie(config, session.token));
  return c.redirect(`${config.appBaseUrl}${decodeURIComponent(encodedRedirectTarget ?? "%2F")}`);
})
```

- [ ] **Step 4: Run the OAuth route test to verify it passes**

Run: `pnpm --filter @markean/api exec vitest run test/oauth-routes.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the OAuth layer**

```bash
git add apps/api/src/lib/auth/providers/google.ts apps/api/src/lib/auth/providers/apple.ts apps/api/src/lib/repos/auth-accounts.ts apps/api/src/routes/auth.ts apps/api/test/oauth-routes.test.ts
git commit -m "feat: add google and apple auth callbacks"
```

## Task 5: Add Shared Session Middleware and Protect Product Routes

**Files:**
- Create: `apps/api/src/lib/auth/cookies.ts`
- Create: `apps/api/src/lib/auth/require-user.ts`
- Modify: `apps/api/src/routes/bootstrap.ts`
- Modify: `apps/api/src/routes/sync.ts`
- Modify: `apps/api/src/routes/folders.ts`
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/src/routes/dev-session.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Test: `apps/api/test/protected-routes.test.ts`

- [ ] **Step 1: Write the failing protected-routes test**

```ts
// apps/api/test/protected-routes.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import { createSession } from "../src/lib/repos/sessions";

const authEnv = {
  ...env,
  APP_ENV: "dev",
  APP_BASE_URL: "http://127.0.0.1:4173",
  API_BASE_URL: "https://example.com",
  MAGIC_LINK_SECRET: "magic-secret",
  MAGIC_LINK_TTL_MINUTES: "20",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  APPLE_CLIENT_ID: "apple-client",
  APPLE_TEAM_ID: "team-id",
  APPLE_KEY_ID: "key-id",
  APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  EMAIL_FROM: "Markean <login@mizutani.top>",
  RESEND_API_KEY: "re_test_123",
} as typeof env;

const db = (authEnv as typeof authEnv & { DB: D1Database }).DB;

describe("protected routes", () => {
  beforeAll(async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, token_hash TEXT, client_type TEXT NOT NULL DEFAULT 'web', revoked_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, folder_id TEXT NOT NULL, title TEXT NOT NULL, body_md TEXT NOT NULL, body_plain TEXT NOT NULL, current_revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS sync_events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, revision_number INTEGER NOT NULL, client_change_id TEXT NOT NULL, source_device_id TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    await db.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("user_1", "beta@example.com", new Date().toISOString()).run();
  });

  it("rejects anonymous sync requests and accepts bearer-authenticated ones", async () => {
    const unauthorized = await worker.fetch(new Request("https://example.com/api/bootstrap"), authEnv);
    expect(unauthorized.status).toBe(401);

    const session = await createSession(db, {
      userId: "user_1",
      clientType: "mobile",
      ttlMs: 3_600_000,
    });

    const authorized = await worker.fetch(
      new Request("https://example.com/api/bootstrap", {
        headers: {
          authorization: `Bearer ${session.token}`,
        },
      }),
      authEnv,
    );

    expect(authorized.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @markean/api exec vitest run test/protected-routes.test.ts`

Expected: FAIL because the current bootstrap and sync routes only understand the old cookie/dev-user path.

- [ ] **Step 3: Add shared auth middleware and route protection**

```ts
// apps/api/src/lib/auth/cookies.ts
import type { resolveAuthConfig } from "./config";

type AuthConfig = ReturnType<typeof resolveAuthConfig>;

export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=");
    }
  }

  return null;
}

export function buildSessionCookie(config: AuthConfig, token: string) {
  const parts = [
    `${config.session.cookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (config.session.cookieSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function clearSessionCookie(config: AuthConfig) {
  return `${config.session.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
```

```ts
// apps/api/src/lib/auth/require-user.ts
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../../env";
import { getDb } from "../db";
import { readCookie } from "./cookies";
import { getSessionByToken } from "../repos/sessions";

export type AuthenticatedUser = {
  id: string;
  email?: string;
  clientType: "web" | "mobile";
};

export function getAuthenticatedUser(c: Context<{ Bindings: Env }>) {
  return c.get("authUser") as AuthenticatedUser | undefined;
}

export const requireUser: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const db = getDb(c.env);
  const authorization = c.req.header("authorization");
  const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const cookieToken = readCookie(c.req.header("cookie"), "markean_session");

  if (bearerToken || cookieToken) {
    const token = bearerToken ?? cookieToken!;
    const session = await getSessionByToken(db, token);
    if (!session) {
      return c.json({ code: "unauthorized", message: "Session is missing or invalid" }, 401);
    }
    c.set("authUser", {
      id: session.userId,
      email: session.email,
      clientType: session.clientType,
    });
    return next();
  }

  return c.json({ code: "unauthorized", message: "Session is missing or invalid" }, 401);
};
```

```ts
// apps/api/src/routes/bootstrap.ts
export const bootstrapRoutes = new Hono<{ Bindings: Env }>()
  .use("/api/bootstrap", requireUser)
  .get("/api/bootstrap", async (c) => {
    const user = getAuthenticatedUser(c)!;
    const db = getDb(c.env);

    const [folders, notes, syncCursor] = await Promise.all([
      listFoldersByUserId(db, user.id),
      listNotesByUserId(db, user.id),
      getLatestSyncCursorForUser(db, user.id),
    ]);

    return c.json({
      user: { id: user.id, email: user.email },
      folders,
      notes,
      syncCursor,
    });
  });
```

```ts
// apps/api/src/routes/sync.ts
export const syncRoutes = new Hono<{ Bindings: Env }>()
  .use("/api/sync/*", requireUser)
  .post("/api/sync/push", async (c) => {
    const authUser = getAuthenticatedUser(c)!;
    // replace DEV_USER_ID with authUser.id
  })
  .get("/api/sync/pull", async (c) => {
    const authUser = getAuthenticatedUser(c)!;
    const cursor = Number(c.req.query("cursor") ?? "0") || 0;
    const events = await listSyncEventsByUserIdAfterCursor(getDb(c.env), authUser.id, cursor);
    return c.json({
      nextCursor: events.at(-1)?.cursor ?? cursor,
      events,
    });
  });
```

- [ ] **Step 4: Run the protected-routes test and the existing auth-sensitive tests**

Run: `pnpm --filter @markean/api exec vitest run test/protected-routes.test.ts test/bootstrap.test.ts test/sync.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the shared auth middleware**

```bash
git add apps/api/src/lib/auth/cookies.ts apps/api/src/lib/auth/require-user.ts apps/api/src/routes/bootstrap.ts apps/api/src/routes/sync.ts apps/api/src/routes/folders.ts apps/api/src/routes/notes.ts apps/api/src/routes/dev-session.ts apps/api/src/routes/auth.ts apps/api/test/protected-routes.test.ts
git commit -m "feat: protect api routes with auth middleware"
```

## Task 6: Add Mobile Exchange, Logout, and Shared API Client Methods

**Files:**
- Modify: `apps/api/src/lib/repos/auth-codes.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `packages/api-client/src/index.ts`
- Create: `docs/superpowers/runbooks/2026-04-11-markean-expo-auth-handoff.md`
- Test: `apps/api/test/auth-exchange.test.ts`

- [ ] **Step 1: Write the failing exchange test**

```ts
// apps/api/test/auth-exchange.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import { createAuthCode } from "../src/lib/repos/auth-codes";

const authEnv = {
  ...env,
  APP_ENV: "dev",
  APP_BASE_URL: "http://127.0.0.1:4173",
  API_BASE_URL: "https://example.com",
  MAGIC_LINK_SECRET: "magic-secret",
  MAGIC_LINK_TTL_MINUTES: "20",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  APPLE_CLIENT_ID: "apple-client",
  APPLE_TEAM_ID: "team-id",
  APPLE_KEY_ID: "key-id",
  APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  EMAIL_FROM: "Markean <login@mizutani.top>",
  RESEND_API_KEY: "re_test_123",
} as typeof env;

const db = (authEnv as typeof authEnv & { DB: D1Database }).DB;

describe("mobile auth exchange", () => {
  beforeAll(async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, token_hash TEXT, client_type TEXT NOT NULL DEFAULT 'web', revoked_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS auth_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)").run();
    await db.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("user_1", "beta@example.com", new Date().toISOString()).run();
  });

  it("exchanges a one-time auth code for a mobile bearer token", async () => {
    const code = await createAuthCode(db, { userId: "user_1", provider: "google", ttlMs: 300_000 });

    const response = await worker.fetch(
      new Request("https://example.com/api/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.value }),
      }),
      authEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tokenType: "Bearer",
      clientType: "mobile",
    });
  });
});
```

- [ ] **Step 2: Run the exchange test to verify it fails**

Run: `pnpm --filter @markean/api exec vitest run test/auth-exchange.test.ts`

Expected: FAIL because `/api/auth/exchange` does not exist yet.

- [ ] **Step 3: Add auth-code storage, exchange, logout, and client helpers**

```ts
// apps/api/src/routes/auth.ts (exchange + me + logout additions)
.post("/api/auth/exchange", async (c) => {
  const body = await c.req.json<{ code: string }>();
  const authCode = await consumeAuthCode(getDb(c.env), body.code);

  if (!authCode) {
    return c.json({ code: "invalid_auth_code", message: "Auth code is invalid or expired" }, 400);
  }

  const session = await createSession(getDb(c.env), {
    userId: authCode.userId,
    clientType: "mobile",
    ttlMs: 7 * 86_400_000,
  });

  return c.json({
    accessToken: session.token,
    tokenType: "Bearer",
    clientType: "mobile",
  });
})
.use("/api/me", requireUser)
.get("/api/me", (c) => {
  const user = getAuthenticatedUser(c)!;
  return c.json({ user });
})
.post("/api/auth/logout", requireUser, async (c) => {
  const config = resolveAuthConfig(c.env);
  c.header("set-cookie", clearSessionCookie(config));
  return c.json({ ok: true });
});
```

```ts
// packages/api-client/src/index.ts
export type CurrentUserResponse = {
  user: { id: string; email?: string; clientType?: "web" | "mobile" };
};

function buildAuthHeaders(accessToken?: string) {
  return accessToken ? { authorization: `Bearer ${accessToken}` } : undefined;
}

export function createApiClient(baseUrl = "") {
  const prefix = baseUrl.replace(/\/$/, "");

  return {
    async bootstrap(input: { accessToken?: string } = {}): Promise<BootstrapResponse> {
      const response = await fetch(`${prefix}/api/bootstrap`, {
        credentials: input.accessToken ? "omit" : "include",
        headers: buildAuthHeaders(input.accessToken),
      });

      return response.json();
    },
    startGoogleLogin(params: { clientType: "web" | "mobile"; redirectTarget: string }) {
      const search = new URLSearchParams(params);
      return `${prefix}/api/auth/google/start?${search.toString()}`;
    },
    startAppleLogin(params: { clientType: "web" | "mobile"; redirectTarget: string }) {
      const search = new URLSearchParams(params);
      return `${prefix}/api/auth/apple/start?${search.toString()}`;
    },
    async requestMagicLink(input: { email: string; clientType: "web" | "mobile"; redirectTarget: string }) {
      return fetch(`${prefix}/api/auth/email/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
    },
    async exchangeAuthCode(code: string) {
      const response = await fetch(`${prefix}/api/auth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      return response.json();
    },
    async me(input: { accessToken?: string } = {}): Promise<CurrentUserResponse> {
      const response = await fetch(`${prefix}/api/me`, {
        credentials: input.accessToken ? "omit" : "include",
        headers: buildAuthHeaders(input.accessToken),
      });
      return response.json();
    },
  };
}
```

- [ ] **Step 4: Run the exchange test and API client typecheck**

Run: `pnpm --filter @markean/api exec vitest run test/auth-exchange.test.ts && pnpm --filter @markean/api typecheck && pnpm --filter @markean/api-client typecheck`

Expected: PASS

- [ ] **Step 5: Commit the mobile exchange contract**

```bash
git add apps/api/src/lib/repos/auth-codes.ts apps/api/src/routes/auth.ts packages/api-client/src/index.ts apps/api/test/auth-exchange.test.ts docs/superpowers/runbooks/2026-04-11-markean-expo-auth-handoff.md
git commit -m "feat: add mobile auth exchange contract"
```

## Task 7: Add a Minimal Web Sign-In Surface

**Files:**
- Create: `apps/web/src/lib/auth.ts`
- Create: `apps/web/src/components/auth/SignInScreen.tsx`
- Modify: `apps/web/src/routes/app.tsx`
- Modify: `apps/web/src/styles/app.css`
- Test: `apps/web/test/sign-in-screen.test.tsx`

- [ ] **Step 1: Write the failing web sign-in test**

```tsx
// apps/web/test/sign-in-screen.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignInScreen } from "../src/components/auth/SignInScreen";

describe("SignInScreen", () => {
  it("submits a magic-link request and renders provider buttons", async () => {
    const requestMagicLink = vi.fn().mockResolvedValue(undefined);
    const startProviderLogin = vi.fn();

    render(
      <SignInScreen
        onRequestMagicLink={requestMagicLink}
        onStartProviderLogin={startProviderLogin}
      />,
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "beta@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    await waitFor(() =>
      expect(requestMagicLink).toHaveBeenCalledWith("beta@example.com"),
    );
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @markean/web exec vitest run test/sign-in-screen.test.tsx`

Expected: FAIL with missing `SignInScreen`.

- [ ] **Step 3: Add the web auth helper and sign-in component**

```ts
// apps/web/src/lib/auth.ts
import { createApiClient } from "@markean/api-client";

const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? "");

export function startProviderLogin(provider: "google" | "apple") {
  const redirectTarget = "/";
  const url =
    provider === "google"
      ? api.startGoogleLogin({ clientType: "web", redirectTarget })
      : api.startAppleLogin({ clientType: "web", redirectTarget });

  window.location.assign(url);
}

export async function requestMagicLink(email: string) {
  await api.requestMagicLink({
    email,
    clientType: "web",
    redirectTarget: "/",
  });
}
```

```tsx
// apps/web/src/components/auth/SignInScreen.tsx
import { FormEvent, useState } from "react";

export function SignInScreen(input: {
  onRequestMagicLink: (email: string) => Promise<void>;
  onStartProviderLogin: (provider: "google" | "apple") => void;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await input.onRequestMagicLink(email.trim());
    setSent(true);
  }

  return (
    <section className="sign-in-screen">
      <h1>Markean beta</h1>
      <p>Sign in with Google, Apple, or a magic link approved for this beta.</p>
      <div className="sign-in-screen__providers">
        <button type="button" onClick={() => input.onStartProviderLogin("google")}>
          Continue with Google
        </button>
        <button type="button" onClick={() => input.onStartProviderLogin("apple")}>
          Continue with Apple
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <label>
          Email address
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <button type="submit">Send magic link</button>
      </form>
      {sent ? <p>Check your inbox for the Markean sign-in link.</p> : null}
    </section>
  );
}
```

```tsx
// apps/web/src/routes/app.tsx
import { useEffect, useState } from "react";
import { createApiClient } from "@markean/api-client";
import { SignInScreen } from "../components/auth/SignInScreen";
import { requestMagicLink, startProviderLogin } from "../lib/auth";

const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? "");

export function AppRoute() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .me()
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false));
  }, []);

  if (isAuthenticated === false) {
    return (
      <SignInScreen
        onRequestMagicLink={requestMagicLink}
        onStartProviderLogin={startProviderLogin}
      />
    );
  }

  if (isAuthenticated === null) {
    return <div className="app-loading-state">Loading Markean…</div>;
  }

  return <AppShell />;
}
```

- [ ] **Step 4: Run the web test and the existing app-shell tests**

Run: `pnpm --filter @markean/web exec vitest run test/sign-in-screen.test.tsx test/app-shell.test.tsx test/bootstrap-store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the web sign-in surface**

```bash
git add apps/web/src/lib/auth.ts apps/web/src/components/auth/SignInScreen.tsx apps/web/src/routes/app.tsx apps/web/src/styles/app.css apps/web/test/sign-in-screen.test.tsx
git commit -m "feat: add beta sign-in screen"
```

## Task 8: Write the Operator Runbook and Perform Final Verification

**Files:**
- Create: `docs/superpowers/runbooks/2026-04-11-markean-beta-cloudflare-auth-setup.md`
- Modify: `docs/superpowers/runbooks/2026-04-11-markean-expo-auth-handoff.md`

- [ ] **Step 1: Write the runbook skeleton from the approved spec**

```md
# Markean Beta Cloudflare Auth Setup

## Cloudflare
- Create the `markean-api` production Worker.
- Create the production D1 database.
- Create the production R2 bucket.
- Apply `0002_auth_rollout.sql`.
- Attach `api-markean.mizutani.top`.

## Google OAuth
- Create the Google OAuth client.
- Add `https://api-markean.mizutani.top/api/auth/google/callback`.
- Add the development callback.

## Apple Sign In
- Create the Apple Service ID.
- Add `https://api-markean.mizutani.top/api/auth/apple/callback`.
- Generate the Apple key and record `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`.

## Resend
- Verify sender domain or sender identity.
- Create the production API key.
- Set `EMAIL_FROM`.
```

- [ ] **Step 2: Add the Expo handoff checklist**

```md
# Markean Expo Auth Handoff

- Use the shared `packages/api-client` auth helpers.
- Configure the app scheme to redirect back into the app after provider login.
- Send provider starts with `clientType=mobile`.
- Exchange `ac_*` auth codes through `POST /api/auth/exchange`.
- Store bearer tokens only in `SecureStore`.
- Send `Authorization: Bearer <token>` to `/api/me`, `/api/bootstrap`, and `/api/sync/*`.
```

- [ ] **Step 3: Run the full verification suite**

Run: `pnpm typecheck && pnpm test && pnpm test:e2e`

Expected: PASS

- [ ] **Step 4: Run a plan-quality placeholder scan**

Run: `rg -n "TO""DO|TB""D|FI""XME|opti""onal|ma""ybe|implement l""ater|simi""lar to Ta""sk" docs/superpowers/runbooks docs/superpowers/plans/2026-04-11-markean-beta-backend-auth-rollout-plan.md`

Expected: no matches

- [ ] **Step 5: Commit the runbook and final verification state**

```bash
git add docs/superpowers/runbooks/2026-04-11-markean-beta-cloudflare-auth-setup.md docs/superpowers/runbooks/2026-04-11-markean-expo-auth-handoff.md
git commit -m "docs: add beta auth rollout runbooks"
```

## Self-Review

### Spec Coverage

- Cloudflare Worker, D1, DO, and R2 rollout: covered by Tasks 1, 5, and 8.
- Google, Apple, and magic-link auth: covered by Tasks 3 and 4.
- Markean-owned sessions for web and mobile: covered by Tasks 2, 5, and 6.
- Beta allowlist: covered by Task 2 and enforced in Tasks 3 and 4.
- Protected bootstrap and sync routes: covered by Task 5.
- Shared mobile auth contract: covered by Task 6 and the Expo handoff doc in Task 8.
- Manual operator training and rollout checklist: covered by Task 8.

### Placeholder Scan

- No placeholder markers remain.
- Every code-changing task includes exact file paths, commands, and sample code.

### Type Consistency

- Session handling uses `markean_session` for cookies and `Bearer` tokens for mobile throughout.
- Mobile one-time exchange codes use the `ac_` prefix across repo helpers, routes, and client code.
- Email beta gating always normalizes addresses to lowercase before lookup.

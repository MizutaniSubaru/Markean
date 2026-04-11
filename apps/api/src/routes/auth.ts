import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { resolveAuthConfig } from "../lib/auth/config";
import { getDb } from "../lib/db";
import { buildAppleAuthorizationUrl, fetchAppleIdentity } from "../lib/auth/providers/apple";
import { buildGoogleAuthorizationUrl, fetchGoogleIdentity } from "../lib/auth/providers/google";
import { sendMagicLinkEmail } from "../lib/email/resend";
import { isEmailAllowed } from "../lib/repos/beta-allowed-emails";
import { upsertAuthAccount } from "../lib/repos/auth-accounts";
import { createAuthCode } from "../lib/repos/auth-codes";
import { consumeMagicLinkToken, createMagicLinkToken } from "../lib/repos/magic-link-tokens";
import { createSession } from "../lib/repos/sessions";

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const encoder = new TextEncoder();
const INVALID_REDIRECT_TARGET = {
  code: "invalid_redirect_target",
  message: "Redirect target is invalid",
} as const;
const INVALID_REQUEST = {
  code: "invalid_request",
  message: "OAuth request is invalid",
} as const;

type OAuthProvider = "google" | "apple";
type OAuthClientType = "web" | "mobile";
type OAuthState = {
  provider: OAuthProvider;
  clientType: OAuthClientType;
  redirectTarget: string;
};
type AuthContext = Context<{ Bindings: Env }>;

const invalidRedirectTarget = () => ({
  ok: false as const,
});

const validRedirectTarget = (redirectTarget: string) => ({
  ok: true as const,
  redirectTarget,
});

const validateWebRedirectTarget = (value?: string) => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return validRedirectTarget("/");
  }

  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return invalidRedirectTarget();
  }

  return validRedirectTarget(trimmed);
};

const validateMobileRedirectTarget = (value?: string) => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return invalidRedirectTarget();
  }

  try {
    const url = new URL(trimmed);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "javascript:" ||
      url.protocol === "data:" ||
      url.protocol === "vbscript:"
    ) {
      return invalidRedirectTarget();
    }
  } catch {
    return invalidRedirectTarget();
  }

  return validRedirectTarget(trimmed);
};

const validateRedirectTarget = (clientType: "web" | "mobile", value?: string) =>
  clientType === "web" ? validateWebRedirectTarget(value) : validateMobileRedirectTarget(value);

const toBase64Url = (value: string) =>
  btoa(
    Array.from(encoder.encode(value))
      .map((byte) => String.fromCharCode(byte))
      .join(""),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const encodeOAuthState = (state: OAuthState) => toBase64Url(JSON.stringify(state));

const decodeOAuthState = (value: string): OAuthState | null => {
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as Partial<OAuthState>;

    if (
      (parsed.provider !== "google" && parsed.provider !== "apple") ||
      (parsed.clientType !== "web" && parsed.clientType !== "mobile") ||
      typeof parsed.redirectTarget !== "string"
    ) {
      return null;
    }

    return {
      provider: parsed.provider,
      clientType: parsed.clientType,
      redirectTarget: parsed.redirectTarget,
    };
  } catch {
    return null;
  }
};

const sessionCookieValue = (config: ReturnType<typeof resolveAuthConfig>, token: string) => {
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
};

const resolveWebRedirect = (appBaseUrl: string, redirectTarget: string) => {
  return new URL(redirectTarget, appBaseUrl).toString();
};

const resolveMobileRedirect = (redirectTarget: string, code: string) => {
  const url = new URL(redirectTarget);
  url.searchParams.set("code", code);
  return url.toString();
};

const ensureUserByEmail = async (db: D1Database, email: string) => {
  const existing = await db
    .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: string }>();

  if (existing) {
    return existing.id;
  }

  const id = `user_${crypto.randomUUID()}`;
  await db
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .bind(id, email, new Date().toISOString())
    .run();

  return id;
};

const parseCallbackParams = async (c: AuthContext) => {
  if (c.req.method === "POST") {
    const body = await c.req.raw.formData();
    return {
      code: body.get("code")?.toString(),
      state: body.get("state")?.toString(),
    };
  }

  return {
    code: c.req.query("code") ?? undefined,
    state: c.req.query("state") ?? undefined,
  };
};

const createOAuthSuccessResponse = async (
  c: AuthContext,
  input: {
    provider: OAuthProvider;
    clientType: OAuthClientType;
    redirectTarget: string;
    email: string;
    providerSubject: string;
    emailVerified: boolean;
  },
) => {
  const db = getDb(c.env);
  const config = resolveAuthConfig(c.env);
  const email = normalizeEmail(input.email);

  if (!(await isEmailAllowed(db, email))) {
    return c.json(
      { code: "beta_access_denied", message: "Email is not approved for this beta" },
      403,
    );
  }

  const userId = await ensureUserByEmail(db, email);
  await upsertAuthAccount(db, {
    userId,
    provider: input.provider,
    providerSubject: input.providerSubject,
    email,
    emailVerified: input.emailVerified,
  });

  if (input.clientType === "web") {
    const session = await createSession(db, {
      userId,
      clientType: "web",
      ttlMs: 7 * 86_400_000,
    });

    c.header("set-cookie", sessionCookieValue(config, session.token));
    return c.redirect(resolveWebRedirect(config.appBaseUrl, input.redirectTarget));
  }

  const authCode = await createAuthCode(db, {
    userId,
    provider: input.provider,
    ttlMs: 300_000,
  });

  return c.redirect(resolveMobileRedirect(input.redirectTarget, authCode.value));
};

export const authRoutes = new Hono<{ Bindings: Env }>()
  .get("/api/auth/google/start", async (c) => {
    const clientType = c.req.query("clientType");
    const redirectTarget = c.req.query("redirectTarget") ?? undefined;

    if (clientType !== "web" && clientType !== "mobile") {
      return c.json(INVALID_REQUEST, 400);
    }

    const validatedRedirectTarget = validateRedirectTarget(clientType, redirectTarget);

    if (!validatedRedirectTarget.ok) {
      return c.json(INVALID_REDIRECT_TARGET, 400);
    }

    const config = resolveAuthConfig(c.env);
    const state = encodeOAuthState({
      provider: "google",
      clientType,
      redirectTarget: validatedRedirectTarget.redirectTarget,
    });

    return c.redirect(
      buildGoogleAuthorizationUrl(config.google, {
        state,
      }),
    );
  })
  .get("/api/auth/google/callback", async (c) => {
    const { code, state } = await parseCallbackParams(c);

    if (!code || !state) {
      return c.json(INVALID_REQUEST, 400);
    }

    const decodedState = decodeOAuthState(state);
    if (!decodedState || decodedState.provider !== "google") {
      return c.json(INVALID_REQUEST, 400);
    }

    const validatedRedirectTarget = validateRedirectTarget(
      decodedState.clientType,
      decodedState.redirectTarget,
    );
    if (!validatedRedirectTarget.ok) {
      return c.json(INVALID_REDIRECT_TARGET, 400);
    }

    const config = resolveAuthConfig(c.env);
    const identity = await fetchGoogleIdentity(config.google, code);

    return createOAuthSuccessResponse(c, {
      provider: "google",
      clientType: decodedState.clientType,
      redirectTarget: validatedRedirectTarget.redirectTarget,
      email: identity.email,
      providerSubject: identity.providerSubject,
      emailVerified: identity.emailVerified,
    });
  })
  .get("/api/auth/apple/start", async (c) => {
    const clientType = c.req.query("clientType");
    const redirectTarget = c.req.query("redirectTarget") ?? undefined;

    if (clientType !== "web" && clientType !== "mobile") {
      return c.json(INVALID_REQUEST, 400);
    }

    const validatedRedirectTarget = validateRedirectTarget(clientType, redirectTarget);

    if (!validatedRedirectTarget.ok) {
      return c.json(INVALID_REDIRECT_TARGET, 400);
    }

    const config = resolveAuthConfig(c.env);
    const state = encodeOAuthState({
      provider: "apple",
      clientType,
      redirectTarget: validatedRedirectTarget.redirectTarget,
    });

    return c.redirect(
      buildAppleAuthorizationUrl(config.apple, {
        state,
      }),
    );
  })
  .all("/api/auth/apple/callback", async (c) => {
    const { code, state } = await parseCallbackParams(c);

    if (!code || !state) {
      return c.json(INVALID_REQUEST, 400);
    }

    const decodedState = decodeOAuthState(state);
    if (!decodedState || decodedState.provider !== "apple") {
      return c.json(INVALID_REQUEST, 400);
    }

    const validatedRedirectTarget = validateRedirectTarget(
      decodedState.clientType,
      decodedState.redirectTarget,
    );
    if (!validatedRedirectTarget.ok) {
      return c.json(INVALID_REDIRECT_TARGET, 400);
    }

    const config = resolveAuthConfig(c.env);
    const identity = await fetchAppleIdentity(config.apple, code);

    return createOAuthSuccessResponse(c, {
      provider: "apple",
      clientType: decodedState.clientType,
      redirectTarget: validatedRedirectTarget.redirectTarget,
      email: identity.email,
      providerSubject: identity.providerSubject,
      emailVerified: identity.emailVerified,
    });
  })
  .post("/api/auth/email/request", async (c) => {
    const body = await c.req.json<{
      email: string;
      clientType: "web" | "mobile";
      redirectTarget?: string;
    }>();

    if (!body?.email || (body.clientType !== "web" && body.clientType !== "mobile")) {
      return c.json({ code: "invalid_request", message: "Email and clientType are required" }, 400);
    }

    const email = normalizeEmail(body.email);
    const db = getDb(c.env);
    const validatedRedirectTarget = validateRedirectTarget(body.clientType, body.redirectTarget);

    if (!validatedRedirectTarget.ok) {
      return c.json(INVALID_REDIRECT_TARGET, 400);
    }

    if (!(await isEmailAllowed(db, email))) {
      return c.json(
        { code: "beta_access_denied", message: "Email is not approved for this beta" },
        403,
      );
    }

    const config = resolveAuthConfig(c.env);
    const token = await createMagicLinkToken(db, {
      email,
      clientType: body.clientType,
      redirectTarget: validatedRedirectTarget.redirectTarget,
      ttlMs: config.magicLink.ttlMinutes * 60_000,
    });
    const verificationUrl = `${config.apiBaseUrl}/api/auth/email/verify?token=${encodeURIComponent(token.token)}`;

    await sendMagicLinkEmail({
      apiKey: config.resend.apiKey,
      from: config.resend.from,
      to: email,
      linkUrl: verificationUrl,
    });

    return c.json({ ok: true }, 202);
  })
  .get("/api/auth/email/verify", async (c) => {
    const token = c.req.query("token") ?? "";
    const db = getDb(c.env);
    const config = resolveAuthConfig(c.env);
    const consumed = await consumeMagicLinkToken(db, token);

    if (!consumed) {
      return c.json({ code: "invalid_magic_link", message: "Magic link is invalid or expired" }, 400);
    }

    const validatedRedirectTarget = validateRedirectTarget(
      consumed.clientType,
      consumed.redirectTarget,
    );

    if (!validatedRedirectTarget.ok) {
      return c.json(INVALID_REDIRECT_TARGET, 400);
    }

    const userId = await ensureUserByEmail(db, consumed.email);

    if (consumed.clientType === "web") {
      const session = await createSession(db, {
        userId,
        clientType: "web",
        ttlMs: 7 * 86_400_000,
      });

      c.header("set-cookie", sessionCookieValue(config, session.token));
      return c.redirect(resolveWebRedirect(config.appBaseUrl, validatedRedirectTarget.redirectTarget));
    }

    const authCode = await createAuthCode(db, {
      userId,
      provider: "magic_link",
      ttlMs: 300_000,
    });

    return c.redirect(resolveMobileRedirect(validatedRedirectTarget.redirectTarget, authCode.value));
  });

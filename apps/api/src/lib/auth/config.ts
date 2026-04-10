import type { Env } from "../../env";

type AuthEnvShape = Pick<
  Env,
  | "APP_ENV"
  | "APP_BASE_URL"
  | "API_BASE_URL"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "APPLE_CLIENT_ID"
  | "APPLE_TEAM_ID"
  | "APPLE_KEY_ID"
  | "APPLE_PRIVATE_KEY"
  | "MAGIC_LINK_SECRET"
  | "MAGIC_LINK_TTL_MINUTES"
  | "EMAIL_FROM"
  | "RESEND_API_KEY"
>;

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const parsePositiveInteger = (value: string, name: string) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

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
      ttlMinutes: parsePositiveInteger(env.MAGIC_LINK_TTL_MINUTES, "MAGIC_LINK_TTL_MINUTES"),
    },
    resend: {
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
    },
  };
}

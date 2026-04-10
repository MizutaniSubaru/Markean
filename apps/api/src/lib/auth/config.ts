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

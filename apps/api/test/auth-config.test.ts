import { describe, expect, it } from "vitest";
import { resolveAuthConfig } from "../src/lib/auth/config";

describe("resolveAuthConfig", () => {
  const baseEnv = {
    APP_ENV: "prod",
    APP_BASE_URL: "https://markean.mizutani.top//",
    API_BASE_URL: "https://api-markean.mizutani.top//",
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
  } as const;

  it("normalizes trailing slashes from env URLs", () => {
    const config = resolveAuthConfig(baseEnv);

    expect(config.appBaseUrl).toBe("https://markean.mizutani.top");
    expect(config.apiBaseUrl).toBe("https://api-markean.mizutani.top");
    expect(config.google.callbackUrl).toBe(
      "https://api-markean.mizutani.top/api/auth/google/callback",
    );
    expect(config.apple.callbackUrl).toBe(
      "https://api-markean.mizutani.top/api/auth/apple/callback",
    );
  });

  it("sets cookie security from the app env", () => {
    expect(resolveAuthConfig(baseEnv).session.cookieSecure).toBe(true);
    expect(
      resolveAuthConfig({
        ...baseEnv,
        APP_ENV: "dev",
        APP_BASE_URL: "http://127.0.0.1:4173//",
        API_BASE_URL: "http://127.0.0.1:8787//",
      }).session.cookieSecure,
    ).toBe(false);
  });

  it("derives the ttl from env", () => {
    const config = resolveAuthConfig({
      ...baseEnv,
    });

    expect(config.magicLink.ttlMinutes).toBe(20);
    expect(config.session.cookieName).toBe("markean_session");
  });

  it("rejects invalid ttl values", () => {
    expect(() =>
      resolveAuthConfig({
        ...baseEnv,
        MAGIC_LINK_TTL_MINUTES: "abc",
      }),
    ).toThrow("MAGIC_LINK_TTL_MINUTES must be a positive integer");

    expect(() =>
      resolveAuthConfig({
        ...baseEnv,
        MAGIC_LINK_TTL_MINUTES: "0",
      }),
    ).toThrow("MAGIC_LINK_TTL_MINUTES must be a positive integer");
  });
});

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

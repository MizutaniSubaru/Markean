import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientHttpError, createApiClient } from "../src";

describe("createApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws an HTTP error when bootstrap is unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(createApiClient("https://api.example").bootstrap()).rejects.toMatchObject({
      status: 401,
      body: { error: "Unauthorized" },
    });
  });

  it("requests a web magic link with credentials included", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("").requestMagicLink({
        email: "beta@example.com",
        redirectTarget: "/notes?from=login",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/email/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: "beta@example.com",
        clientType: "web",
        redirectTarget: "/notes?from=login",
      }),
    });
  });

  it("builds web OAuth start URLs on the API origin", () => {
    const api = createApiClient("https://api.example/");

    expect(api.authStartUrl("google", { redirectTarget: "/notes?from=google" })).toBe(
      "https://api.example/api/auth/google/start?clientType=web&redirectTarget=%2Fnotes%3Ffrom%3Dgoogle",
    );
    expect(api.authStartUrl("apple", { redirectTarget: "/" })).toBe(
      "https://api.example/api/auth/apple/start?clientType=web&redirectTarget=%2F",
    );
  });

  it("surfaces magic link request errors with status and body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "beta_access_denied",
            message: "Email is not approved for this beta",
          }),
          {
            status: 403,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      createApiClient("").requestMagicLink({
        email: "blocked@example.com",
        redirectTarget: "/",
      }),
    ).rejects.toBeInstanceOf(ApiClientHttpError);
  });
});

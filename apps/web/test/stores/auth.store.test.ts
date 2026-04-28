import { afterEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../../src/features/auth/store/auth.store";

describe("auth store", () => {
  afterEach(() => {
    useAuthStore.getState().resetAuth();
  });

  it("tracks authenticated and unauthenticated remote bootstrap state", () => {
    expect(useAuthStore.getState()).toMatchObject({
      status: "unknown",
      userEmail: null,
    });

    useAuthStore.getState().markAuthenticated("beta@example.com");
    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      userEmail: "beta@example.com",
    });

    useAuthStore.getState().markUnauthenticated();
    expect(useAuthStore.getState()).toMatchObject({
      status: "unauthenticated",
      userEmail: null,
    });
  });
});

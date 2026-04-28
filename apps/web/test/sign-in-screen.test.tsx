import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInScreen } from "../src/features/auth/components/SignInScreen";
import { createI18n, I18nProvider } from "../src/i18n";

function renderSignIn() {
  return render(
    <I18nProvider value={createI18n("en")}>
      <SignInScreen />
    </I18nProvider>,
  );
}

describe("SignInScreen", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders OAuth links for the current page", () => {
    window.history.replaceState(null, "", "/notes?from=test");

    renderSignIn();

    expect(screen.getByRole("heading", { name: "Sign in to Markean" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
      "href",
      "/api/auth/google/start?clientType=web&redirectTarget=%2Fnotes%3Ffrom%3Dtest",
    );
    expect(screen.getByRole("link", { name: "Continue with Apple" })).toHaveAttribute(
      "href",
      "/api/auth/apple/start?clientType=web&redirectTarget=%2Fnotes%3Ffrom%3Dtest",
    );
  });

  it("requests a magic link and shows the sent state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSignIn();
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "beta@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/email/request", expect.any(Object));
    });
    expect(await screen.findByText("Check your email for a sign-in link.")).toBeInTheDocument();
  });
});

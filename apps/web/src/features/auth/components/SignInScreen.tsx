import { FormEvent, useMemo, useState } from "react";
import { ApiClientHttpError, createApiClient } from "@markean/api-client";
import { useI18n } from "../../../i18n";

type RequestState = "idle" | "sending" | "sent" | "error";

function getCurrentRedirectTarget(): string {
  if (typeof window === "undefined") return "/";

  const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return target.startsWith("/") ? target : "/";
}

function getErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiClientHttpError)) return null;
  if (!error.body || typeof error.body !== "object") return null;

  const message = (error.body as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

export function SignInScreen() {
  const { t } = useI18n();
  const api = useMemo(() => createApiClient(""), []);
  const redirectTarget = getCurrentRedirectTarget();
  const [email, setEmail] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const googleHref = api.authStartUrl("google", { redirectTarget });
  const appleHref = api.authStartUrl("apple", { redirectTarget });

  async function submitMagicLink(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || requestState === "sending") return;

    setRequestState("sending");
    setErrorMessage(null);

    try {
      await api.requestMagicLink({
        email: trimmedEmail,
        redirectTarget,
      });
      setRequestState("sent");
    } catch (error) {
      setRequestState("error");
      setErrorMessage(getErrorMessage(error) ?? t("auth.magicLinkError"));
    }
  }

  return (
    <main className="sign-in-page">
      <section className="sign-in-panel" aria-labelledby="sign-in-title">
        <div className="sign-in-brand">
          <span className="sign-in-logo" aria-hidden="true">M</span>
          <div>
            <h1 id="sign-in-title">{t("auth.title")}</h1>
            <p>{t("auth.subtitle")}</p>
          </div>
        </div>

        <div className="sign-in-providers">
          <a className="sign-in-provider" href={googleHref}>
            {t("auth.google")}
          </a>
          <a className="sign-in-provider" href={appleHref}>
            {t("auth.apple")}
          </a>
        </div>

        <form className="sign-in-form" onSubmit={(event) => void submitMagicLink(event)}>
          <label htmlFor="sign-in-email">{t("auth.email")}</label>
          <div className="sign-in-email-row">
            <input
              id="sign-in-email"
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" disabled={requestState === "sending"}>
              {requestState === "sending" ? t("auth.sending") : t("auth.sendMagicLink")}
            </button>
          </div>
        </form>

        <p className="sign-in-status" aria-live="polite">
          {requestState === "sent" ? t("auth.magicLinkSent") : null}
          {requestState === "error" ? errorMessage : null}
        </p>
      </section>
    </main>
  );
}

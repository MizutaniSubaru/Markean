import { createContext, useContext } from "react";
import { en } from "./en";
import { zh } from "./zh";

type I18nInstance = {
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const dictionaries: Record<string, Record<string, string>> = { en, zh };

function resolveLocale(raw: string): string {
  if (raw.startsWith("zh")) return "zh";
  return "en";
}

export function detectLocale(): string {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem("markean:locale");
    if (stored) return resolveLocale(stored);
  } catch {
    // Fall back to navigator language when storage is unavailable.
  }
  return resolveLocale(navigator.language);
}

export function createI18n(rawLocale: string): I18nInstance {
  const locale = resolveLocale(rawLocale);
  const dict = dictionaries[locale] ?? dictionaries.en;

  function t(key: string, params?: Record<string, string | number>): string {
    let text = dict[key] ?? dictionaries.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }

  return { locale, t };
}

const I18nContext = createContext<I18nInstance>(createI18n("en"));

export const I18nProvider = I18nContext.Provider;

export function useI18n(): I18nInstance {
  return useContext(I18nContext);
}

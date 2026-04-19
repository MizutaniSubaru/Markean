import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n, detectLocale } from "../src/i18n";

describe("i18n", () => {
  it("returns English text for en locale", () => {
    const i18n = createI18n("en");
    expect(i18n.t("sidebar.title")).toBe("Folders");
  });

  it("returns Chinese text for zh-CN locale", () => {
    const i18n = createI18n("zh-CN");
    expect(i18n.t("sidebar.title")).toBe("文件夹");
  });

  it("maps zh-TW to Chinese", () => {
    const i18n = createI18n("zh-TW");
    expect(i18n.t("sidebar.search")).toBe("搜索");
  });

  it("falls back to English for unknown locale", () => {
    const i18n = createI18n("fr-FR");
    expect(i18n.t("sidebar.title")).toBe("Folders");
  });

  it("interpolates {n} in count strings", () => {
    const i18n = createI18n("en");
    expect(i18n.t("noteList.count", { n: 5 })).toBe("5 notes");
  });

  it("interpolates {n} in Chinese count strings", () => {
    const i18n = createI18n("zh");
    expect(i18n.t("noteList.count", { n: 3 })).toBe("3 篇笔记");
  });
});

describe("detectLocale", () => {
  const originalLocalStorage = window.localStorage;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it("falls back to navigator.language when storage access throws", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem() {
          throw new Error("storage blocked");
        },
      },
    });

    const expected = navigator.language.startsWith("zh") ? "zh" : "en";
    expect(detectLocale()).toBe(expected);
  });
});

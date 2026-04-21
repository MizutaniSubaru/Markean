import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../src/hooks/useMediaQuery";

type MatchMediaListener = (event: MediaQueryListEvent) => void;
const originalMatchMedia = window.matchMedia;

function setupMatchMedia(
  initialMatch: boolean,
  mode: "modern" | "legacy" = "modern",
) {
  const listeners = new Set<MatchMediaListener>();
  let matches = initialMatch;
  const base = {
    matches,
    media: "",
    onchange: null,
    dispatchEvent: () => true,
  };

  const modernMethods = {
    addEventListener: (type: string, listener: MatchMediaListener) => {
      if (type === "change") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: MatchMediaListener) => {
      if (type === "change") listeners.delete(listener);
    },
  };

  const legacyMethods = {
    addListener: (listener: MatchMediaListener) => listeners.add(listener),
    removeListener: (listener: MatchMediaListener) => listeners.delete(listener),
  };

  const mockMatchMedia = vi.fn().mockImplementation((query: string) => {
    const methods = mode === "legacy" ? legacyMethods : modernMethods;
    return { ...base, ...methods, media: query };
  });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: mockMatchMedia,
  });

  const emitChange = (nextMatch: boolean) => {
    matches = nextMatch;
    const event = { matches: nextMatch } as MediaQueryListEvent;
    listeners.forEach((listener) => listener(event));
  };
  return { emitChange };
}

function MediaQueryProbe({ query }: { query: string }) {
  const matches = useMediaQuery(query);
  return createElement("span", null, String(matches));
}

describe("useMediaQuery", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it("returns false initially when media does not match", () => {
    setupMatchMedia(false);

    render(createElement(MediaQueryProbe, { query: "(min-width: 768px)" }));

    expect(screen.getByText("false")).toBeTruthy();
  });

  it("updates when media query changes", () => {
    const matchMedia = setupMatchMedia(false);

    render(createElement(MediaQueryProbe, { query: "(min-width: 768px)" }));
    expect(screen.getByText("false")).toBeTruthy();

    act(() => {
      matchMedia.emitChange(true);
    });

    expect(screen.getByText("true")).toBeTruthy();
  });

  it("returns false when matchMedia is unavailable", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    render(createElement(MediaQueryProbe, { query: "(min-width: 768px)" }));

    expect(screen.getByText("false")).toBeTruthy();
  });

  it("subscribes with legacy addListener/removeListener", () => {
    const matchMedia = setupMatchMedia(false, "legacy");

    render(createElement(MediaQueryProbe, { query: "(min-width: 768px)" }));
    expect(screen.getByText("false")).toBeTruthy();

    act(() => {
      matchMedia.emitChange(true);
    });

    expect(screen.getByText("true")).toBeTruthy();
  });
});

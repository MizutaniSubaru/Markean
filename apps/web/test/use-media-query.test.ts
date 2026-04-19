import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../src/hooks/useMediaQuery";

type MatchMediaListener = (event: MediaQueryListEvent) => void;

function setupMatchMedia(initialMatch: boolean) {
  const listeners = new Set<MatchMediaListener>();
  let matches = initialMatch;

  const originalMatchMedia = window.matchMedia;

  const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (type: string, listener: MatchMediaListener) => {
      if (type === "change") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: MatchMediaListener) => {
      if (type === "change") listeners.delete(listener);
    },
    addListener: (listener: MatchMediaListener) => listeners.add(listener),
    removeListener: (listener: MatchMediaListener) => listeners.delete(listener),
    dispatchEvent: () => true,
  }));

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

  const restore = () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  };

  return { emitChange, restore };
}

function MediaQueryProbe({ query }: { query: string }) {
  const matches = useMediaQuery(query);
  return createElement("span", null, String(matches));
}

describe("useMediaQuery", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns false initially when media does not match", () => {
    const matchMedia = setupMatchMedia(false);

    render(createElement(MediaQueryProbe, { query: "(min-width: 768px)" }));

    expect(screen.getByText("false")).toBeTruthy();
    matchMedia.restore();
  });

  it("updates when media query changes", () => {
    const matchMedia = setupMatchMedia(false);

    render(createElement(MediaQueryProbe, { query: "(min-width: 768px)" }));
    expect(screen.getByText("false")).toBeTruthy();

    act(() => {
      matchMedia.emitChange(true);
    });

    expect(screen.getByText("true")).toBeTruthy();
    matchMedia.restore();
  });
});

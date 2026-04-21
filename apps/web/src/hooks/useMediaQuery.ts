import { useEffect, useState } from "react";

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function getMatchMediaResult(query: string): LegacyMediaQueryList | null {
  if (typeof window === "undefined") return null;
  if (typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query) as LegacyMediaQueryList;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    const mediaQueryList = getMatchMediaResult(query);
    return mediaQueryList ? mediaQueryList.matches : false;
  });

  useEffect(() => {
    const mediaQueryList = getMatchMediaResult(query);
    if (!mediaQueryList) {
      setMatches(false);
      return;
    }

    setMatches(mediaQueryList.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
      return () => {
        mediaQueryList.removeEventListener("change", handleChange);
      };
    }

    if (typeof mediaQueryList.addListener === "function") {
      mediaQueryList.addListener(handleChange);
      return () => {
        if (typeof mediaQueryList.removeListener === "function") {
          mediaQueryList.removeListener(handleChange);
        }
      };
    }

    return;
  }, [query]);

  return matches;
}

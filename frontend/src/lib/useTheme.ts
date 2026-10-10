import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";
export const THEME_KEY = "mindease-theme";

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  // "dark" on the server and on the first client render keeps hydration identical.
  const [theme, setTheme] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(readStoredTheme());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage blocked: theme still applies for this visit */
    }
  }, [theme, ready]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, setTheme, toggle };
}
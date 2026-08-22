import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Theme handling — class strategy on <html>, persisted in localStorage.
 *
 * Modes:
 *  - "balanced" (app default): mid-luminance slate-indigo surfaces — the
 *    signature Prokon look; sits between light and dark.
 *  - "light": classic near-white surfaces.
 *  - "dark": true dark surfaces (.dark class, also enables Tailwind dark:).
 *  - "system": follows OS preference → resolves to light or dark.
 *
 * A tiny inline script in __root.tsx applies classes BEFORE first paint
 * (no flash); this provider keeps React state in sync and re-applies on
 * change / OS preference change while running.
 */

export type Theme = "light" | "balanced" | "dark" | "system";
export type ResolvedAppearance = "light" | "balanced" | "dark";

const STORAGE_KEY = "prokon-theme";
const DEFAULT_THEME: Theme = "balanced";

type ThemeContextValue = {
  theme: Theme;
  appearance: ResolvedAppearance;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  appearance: "balanced",
  setTheme: () => {},
});

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStored(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "balanced" || v === "dark" || v === "system" ? v : DEFAULT_THEME;
}

export function resolve(theme: Theme): ResolvedAppearance {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

function applyClasses(appearance: ResolvedAppearance) {
  const el = document.documentElement;
  el.classList.toggle("theme-balanced", appearance === "balanced");
  el.classList.toggle("dark", appearance === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [appearance, setAppearance] = useState<ResolvedAppearance>("balanced");

  // Sync with the classes the inline boot script already applied.
  useEffect(() => {
    const stored = readStored();
    setThemeState(stored);
    const r = resolve(stored);
    setAppearance(r);
    applyClasses(r);
  }, []);

  // Follow OS preference changes while theme === "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolve("system");
      setAppearance(r);
      applyClasses(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function setTheme(next: Theme) {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode etc. — non-fatal */
    }
    const r = resolve(next);
    setAppearance(r);
    applyClasses(r);
  }

  return (
    <ThemeContext.Provider value={{ theme, appearance, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

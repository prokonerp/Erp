import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Theme handling — locked to Navy Premium (light = glacier #F1F5F9 + navy #1E3A5F).
 * Previous modes balanced/comfort removed per user request. Only light/dark/system remain.
 * A tiny inline script in __root.tsx applies classes BEFORE first paint.
 */

export type Theme = "light" | "dark" | "system";
export type ResolvedAppearance = "light" | "dark";

const STORAGE_KEY = "prokon-theme";
const DEFAULT_THEME: Theme = "light";

type ThemeContextValue = {
  theme: Theme;
  appearance: ResolvedAppearance;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  appearance: "light",
  setTheme: () => {},
});

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStored(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const v = window.localStorage.getItem(STORAGE_KEY);
  // Migrate old balanced/comfort values to light (navy)
  if (v === "balanced" || v === "comfort") return "light";
  return v === "light" || v === "dark" || v === "system" ? v : DEFAULT_THEME;
}

export function resolve(theme: Theme): ResolvedAppearance {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

function applyClasses(appearance: ResolvedAppearance) {
  const el = document.documentElement;
  el.classList.toggle("dark", appearance === "dark");
  el.dataset.appearance = appearance;
}

export function applyDataAttrs(appearance: ResolvedAppearance) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.appearance = appearance;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [appearance, setAppearance] = useState<ResolvedAppearance>("light");

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

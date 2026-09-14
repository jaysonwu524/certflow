"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: "light" | "dark" | undefined;
  setTheme: (theme: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const themeStorageKey = "certflow.theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): "light" | "dark" {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">();

  useEffect(() => {
    let stored: Theme = "system";
    try {
      const value = window.localStorage.getItem(themeStorageKey);
      if (isTheme(value)) stored = value;
    } catch {
      // Theme persistence is optional.
    }

    const timer = window.setTimeout(() => setThemeState(stored), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const resolved = applyTheme(theme);
    const timer = window.setTimeout(() => setResolvedTheme(resolved), 0);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (theme === "system") setResolvedTheme(applyTheme("system"));
    };
    media.addEventListener?.("change", handleSystemThemeChange);
    return () => {
      window.clearTimeout(timer);
      media.removeEventListener?.("change", handleSystemThemeChange);
    };
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme(nextTheme) {
        if (!isTheme(nextTheme)) return;
        setThemeState(nextTheme);
        setResolvedTheme(applyTheme(nextTheme));
        try {
          window.localStorage.setItem(themeStorageKey, nextTheme);
          document.cookie = `${themeStorageKey}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`;
        } catch {
          // Theme persistence is optional.
        }
      },
    }),
    [resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

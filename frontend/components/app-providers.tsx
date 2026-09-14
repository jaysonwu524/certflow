"use client";

import { ToastProvider } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { useEffect, useState, type ReactNode } from "react";

const themeColorKey = "certflow.themeColor";

function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    try {
      const value = window.localStorage.getItem(themeColorKey);
      if (value === "teal" || value === "blue" || value === "violet" || value === "orange") {
        root.dataset.colorTheme = value;
        document.cookie = `${themeColorKey}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
      }
    } catch {
      // Theme color persistence is optional.
    }
    if (!resolvedTheme) return;
    const reveal = () => {
      root.dataset.themeReady = "true";
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(reveal);
    } else {
      window.setTimeout(reveal, 0);
    }
  }, [resolvedTheme]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: 0 },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeColorSync />
        {children}
        <ToastProvider placement="bottom end" maxVisibleToasts={3} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

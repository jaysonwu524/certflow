import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@heroui/react/styles";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { AppProviders } from "@/components/providers/app-providers";
import { LocaleProvider, type Locale } from "@/components/providers/locale-provider";
import { RealtimeEvents } from "@/components/layout/realtime-events";

export const metadata: Metadata = {
  title: "CertFlow",
  description: "TLS certificate lifecycle operations",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const locale: Locale = cookieStore.get("certflow_locale")?.value === "en" ? "en" : "zh-CN";

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <AppProviders>
          <LocaleProvider initialLocale={locale}>
            <AppShell>{children}</AppShell>
            <RealtimeEvents />
          </LocaleProvider>
        </AppProviders>
      </body>
    </html>
  );
}

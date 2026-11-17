// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata, Viewport } from "next";
import { CommandPalette } from "../components/command-palette";
import { cookies } from "next/headers";
import { AppShell } from "../components/app-shell";
import {
  MODE_COOKIE,
  THEME_COOKIE,
  appearanceAttributes,
  parseMode,
  parseTheme,
} from "../lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aeyhey",
  description: "Your saved links and your interview prep, brought back at the right time.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Aeyhey", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Used one-handed on a phone, so the layout never needs a pinch, but zoom is left
  // available because disabling it breaks the app for anyone who needs larger text.
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The colour theme and the light or dark mode come from a cookie, so the very first
  // paint is already right. See lib/theme.ts.
  const jar = await cookies();
  const appearance = appearanceAttributes(
    parseTheme(jar.get(THEME_COOKIE)?.value),
    parseMode(jar.get(MODE_COOKIE)?.value),
  );

  return (
    <html lang="en" suppressHydrationWarning {...appearance}>
      <body className="min-h-dvh antialiased">
        <AppShell>{children}</AppShell>
        <CommandPalette />
      </body>
    </html>
  );
}

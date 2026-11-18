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
import localFont from "next/font/local";
import "./globals.css";

/*
 * The two faces the phone app uses, so the website reads the same. Sarabun is the text
 * face; Signika, a variable font, is for what people saved and the headings around it.
 * Both are SIL Open Font License, subset to Latin; each folder in app/fonts keeps its licence.
 */
const sarabun = localFont({
  src: [
    { path: "./fonts/sarabun/Sarabun-Regular.woff2", weight: "400" },
    { path: "./fonts/sarabun/Sarabun-Medium.woff2", weight: "500" },
    { path: "./fonts/sarabun/Sarabun-SemiBold.woff2", weight: "600" },
    { path: "./fonts/sarabun/Sarabun-Bold.woff2", weight: "700" },
    { path: "./fonts/sarabun/Sarabun-ExtraBold.woff2", weight: "800" },
  ],
  variable: "--font-sarabun",
  display: "swap",
});

const signika = localFont({
  src: "./fonts/signika/Signika-Variable.woff2",
  weight: "300 700",
  variable: "--font-signika",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aeyhey",
  description:
    "Links, topics, books, notes and your resume, turned into short sessions that bring each thing back until you have it.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Aeyhey", statusBarStyle: "black-translucent" },
};

/** The browser bar's colour follows the chosen mode; light unless someone chose otherwise. */
export async function generateViewport(): Promise<Viewport> {
  const mode = parseMode((await cookies()).get(MODE_COOKIE)?.value);
  return {
    ...viewport,
    themeColor:
      mode === "dark"
        ? "#1a1a1f"
        : mode === "system"
          ? [
              { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
              { media: "(prefers-color-scheme: dark)", color: "#1a1a1f" },
            ]
          : "#fbfbfc",
  };
}

const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Used one-handed on a phone, so the layout never needs a pinch, but zoom is left
  // available because disabling it breaks the app for anyone who needs larger text.
  maximumScale: 5,
  viewportFit: "cover",
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
    <html
      lang="en"
      suppressHydrationWarning
      {...appearance}
      className={`${sarabun.variable} ${signika.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <AppShell>{children}</AppShell>
        <CommandPalette />
      </body>
    </html>
  );
}

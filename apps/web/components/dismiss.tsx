"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// A "Hide" button for the help a new user needs and a regular does not.
//
// The choice is remembered in a cookie, so the server stops rendering the panel at all
// rather than drawing it and hiding it. Like the theme, it is a preference for this
// browser, not account data.

import { useRouter } from "next/navigation";
import { Button } from "@ui-sdk/react/button";

export function DismissButton({ cookie, label = "Hide" }: { cookie: string; label?: string }) {
  const router = useRouter();

  return (
    <Button
      onClick={() => {
        document.cookie = `${cookie}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
        router.refresh();
      }}
      className="text-subtle-foreground hover:text-foreground min-h-8 rounded-md px-1.5 text-xs font-semibold"
    >
      {label}
    </Button>
  );
}

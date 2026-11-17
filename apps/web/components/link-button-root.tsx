"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The client half of LinkButton in ui.tsx.
//
// UI SDK's Button turns into a link when it is handed an <a> element to render, and it
// does that by cloning the element. An element built in a server component reaches a
// client component as a reference, not as an element the client can clone, so on the
// server render the clone comes out with no type and React throws "Element type is
// invalid". Building the <a> here, on the client side of the line, avoids that. Only
// plain values cross: the href, the class names and the already-rendered children.

import type { ReactNode } from "react";
import { Button as SdkButton } from "@ui-sdk/react/button";

export function LinkButtonRoot({
  href,
  external,
  className,
  children,
}: {
  href: string;
  external?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SdkButton
      render={
        <a
          href={href}
          {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
        />
      }
      className={className}
    >
      {children}
    </SdkButton>
  );
}

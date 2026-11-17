"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Appearance: the colour theme and the light or dark mode.
//
// Both take effect the moment they are picked, so there is no Save here. The choice is
// kept in a cookie for this browser (lib/theme.ts), and the colours themselves are the
// token sets in app/globals.css.

import { useState } from "react";
import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import {
  MODES,
  THEMES,
  applyAppearance,
  parseMode,
  parseTheme,
  type ModeId,
  type ThemeId,
} from "../lib/theme";
import { Card, cx } from "./ui";

export function AppearanceSettings() {
  // Read from the page itself, which the server already painted from the cookie. This
  // component only ever mounts in the browser, after its tab is chosen.
  const [theme, setTheme] = useState<ThemeId>(() =>
    parseTheme(document.documentElement.dataset["theme"]),
  );
  const [mode, setMode] = useState<ModeId>(() =>
    parseMode(document.documentElement.dataset["mode"]),
  );

  function chooseTheme(next: ThemeId): void {
    setTheme(next);
    applyAppearance(next, mode);
  }

  function chooseMode(next: ModeId): void {
    setMode(next);
    applyAppearance(theme, next);
  }

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <p id="appearance-theme" className="text-sm font-semibold">
            Colour theme
          </p>
          <p className="text-subtle-foreground text-xs">
            Changes the accent and the background tones. It applies straight away.
          </p>
        </div>
        <RadioGroup
          aria-labelledby="appearance-theme"
          value={theme}
          onValueChange={(next) => next && chooseTheme(parseTheme(String(next)))}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
        >
          {THEMES.map((option) => (
            <label
              key={option.id}
              className={cx(
                "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-3 text-sm font-semibold transition-colors",
                theme === option.id
                  ? "border-primary bg-primary-soft"
                  : "border-border hover:border-border-strong",
              )}
            >
              <Radio value={option.id}>
                <RadioIndicator />
              </Radio>
              <span
                aria-hidden="true"
                className="size-4 shrink-0 rounded-full"
                style={{ background: option.swatch }}
              />
              {option.label}
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <p className="text-sm font-semibold">Light or dark</p>
          <p className="text-subtle-foreground text-xs">
            Every theme has both. Matching your device follows its own setting.
          </p>
        </div>
        <SegmentedControl
          aria-label="Light or dark"
          value={mode}
          onValueChange={(next) => next && chooseMode(parseMode(String(next)))}
        >
          <SegmentedControlIndicator />
          {MODES.map((option) => (
            <SegmentedControlItem key={option.id} value={option.id}>
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      <p className="text-subtle-foreground text-xs">
        Remembered on this browser only. Another device keeps its own choice.
      </p>
    </Card>
  );
}

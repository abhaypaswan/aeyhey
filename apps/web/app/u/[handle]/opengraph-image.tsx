// SPDX-License-Identifier: AGPL-3.0-only
// The card a shared link shows in chats and on social sites (PRD 28), in the profile's own
// look: the person on the left, their streak and numbers on the right, and the last six
// months of activity underneath. This is what makes a pasted link worth tapping.
//
// Every box sets display: flex, because the image renderer refuses a box with more than
// one child without it.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { loadPublicPage } from "../../../lib/public-page";

export const alt = "A reading profile on Aeyhey";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GROUND = "#fafafa";
const CARD = "#ffffff";
const BORDER = "#ececf0";
const INK = "#0a0a0f";
const MUTED = "#71717a";
const INDIGO = "#5b50e6";
const HEAT = ["#f1f1f4", "#c7c3f9", "#8b82f2", "#5b50e6"];

/** The font file, wherever the app was started from. Inter, SIL Open Font License. */
async function font(file: string): Promise<ArrayBuffer | null> {
  const candidates = [
    join(process.cwd(), "app/fonts", file),
    join(process.cwd(), "apps/web/app/fonts", file),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const buffer = await readFile(path);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  }
  return null;
}

function heat(count: number): string {
  if (count === 0) return HEAT[0]!;
  if (count === 1) return HEAT[1]!;
  if (count <= 3) return HEAT[2]!;
  return HEAT[3]!;
}

export default async function OpenGraphImage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const result = await loadPublicPage(handle);
  const inter = await font("Inter-SemiBold.ttf");
  const fonts = inter ? [{ name: "Inter", data: inter, weight: 600 as const }] : [];

  if (result.kind !== "page") {
    return new ImageResponse(
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: GROUND,
          color: INK,
          fontSize: 64,
          fontFamily: "Inter",
        }}
      >
        aeyhey
      </div>,
      { ...size, fonts },
    );
  }

  const { page } = result;
  const stats = page.stats;
  const name = page.name ?? `@${page.handle}`;
  const since = stats ? new Date(stats.since) : null;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // 26 weeks as columns of 7 days, oldest first.
  // The image keeps its 26-week grid; the page shows the full year.
  const counts = stats ? stats.activity.counts.slice(-182) : [];
  const columns: number[][] = [];
  for (let i = 0; i < counts.length; i += 7) columns.push(counts.slice(i, i + 7));

  const tiles = stats
    ? [
        { label: "Links read", value: String(stats.linksRead) },
        { label: "Active days", value: String(stats.daysActive) },
        // With building public, the third tile is hours building; otherwise hours reading.
        page.building
          ? { label: "Building", value: `${Math.floor(page.building.activeMinutes / 60)}h` }
          : { label: "Hours", value: String(Math.floor(stats.minutesRead / 60)) },
      ]
    : [];
  const streak = stats ? (stats.currentStreak > 1 ? stats.currentStreak : stats.longestStreak) : 0;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "56px 64px",
        background: GROUND,
        color: INK,
        fontFamily: "Inter",
        gap: 36,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 40,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 520 }}>
          <div
            style={{
              display: "flex",
              width: 96,
              height: 96,
              borderRadius: 999,
              background: INDIGO,
              color: "#fff",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 44,
            }}
          >
            {(page.name ?? page.handle).charAt(0).toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 56, letterSpacing: -2, lineHeight: 1.05 }}>
              {name}
            </div>
            <div style={{ display: "flex", fontSize: 26, color: MUTED }}>
              {since
                ? `@${page.handle}, reading since ${months[since.getUTCMonth()]} ${since.getUTCFullYear()}`
                : `@${page.handle}`}
            </div>
          </div>
        </div>

        {stats ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 480 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                background: INK,
                color: "#fff",
                borderRadius: 22,
                padding: "20px 24px",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", fontSize: 20, color: "#a1a1aa" }}>
                {stats.currentStreak > 1 ? "Current streak" : "Longest streak"}
              </div>
              <div style={{ display: "flex", fontSize: 60, letterSpacing: -2, lineHeight: 1 }}>
                {`${streak} days`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              {tiles.map((tile) => (
                <div
                  key={tile.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    background: CARD,
                    border: `2px solid ${BORDER}`,
                    borderRadius: 20,
                    padding: "14px 16px",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", fontSize: 18, color: MUTED }}>{tile.label}</div>
                  <div
                    style={{ display: "flex", fontSize: 40, letterSpacing: -1.5, lineHeight: 1 }}
                  >
                    {tile.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flex: 1,
        }}
      >
        {columns.length > 0 ? (
          <div style={{ display: "flex", gap: 6 }}>
            {columns.map((column, c) => (
              <div key={c} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {column.map((count, d) => (
                  <div
                    key={d}
                    style={{
                      display: "flex",
                      width: 22,
                      height: 22,
                      borderRadius: 5,
                      background: heat(count),
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
        <div style={{ display: "flex", fontSize: 26, color: MUTED }}>aeyhey</div>
      </div>
    </div>,
    { ...size, fonts },
  );
}

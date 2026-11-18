// SPDX-License-Identifier: AGPL-3.0-only
// The small drawings that stand in for numbers, as the phone app draws them.
//
// A number on its own is easy to skim past. So the session count sits beside a fan of
// its cards, waiting links are glasses that fill up, decks are a fan of cards and the
// streak is a flame. Each is a few divs, sized in px to match the phone, and each
// carries its number in words for anyone who cannot see it.

import type { CSSProperties } from "react";
import { BookOpen, Check, Flame, IdCard, Lightbulb, NotebookPen } from "lucide-react";
import { mix, siteKey, soft, strong, hueFor, type Hue } from "../lib/hue";
import { cx } from "./ui";

const CANVAS = "var(--color-canvas)";

/** Where card i of n sits in a fan: -1 at the back left to 1 at the front right. */
function fanPosition(index: number, count: number): { p: number; d: number } {
  if (count === 1) return { p: 0, d: 1 };
  const d = index / (count - 1);
  return { p: d * 2 - 1, d };
}

/** The session's cards, fanned out beside "5 cards ready", the front one numbered. */
export function CardFan({ count, scale = 1 }: { count: number; scale?: number }) {
  const n = Math.max(1, Math.min(7, count));
  return (
    <span
      aria-hidden="true"
      className="relative block shrink-0"
      style={{ width: 74 * scale, height: 62 * scale }}
    >
      {Array.from({ length: n }, (_, index) => {
        const { p, d } = fanPosition(index, n);
        const front = index === n - 1;
        const style: CSSProperties = {
          width: 34 * scale,
          height: 46 * scale,
          left: `calc(50% - ${17 * scale}px)`,
          bottom: 4 * scale,
          borderRadius: 7 * scale,
          border: `${1.5 * scale}px solid color-mix(in srgb, ${CANVAS} 90%, transparent)`,
          transform: `translateX(${p * 14 * scale}px) rotate(${p * 0.32}rad)`,
          transformOrigin: "bottom center",
          background: front
            ? "var(--color-primary)"
            : mix("var(--color-surface)", "var(--color-primary)", 0.14 + 0.3 * d, 0.22 + 0.3 * d),
        };
        return (
          <span key={index} className="fan-card absolute grid place-items-center" style={style}>
            {front ? (
              <span
                className="text-primary-foreground font-bold"
                style={{ fontSize: 15 * scale, lineHeight: 1 }}
              >
                {count}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The session's cards squared away in a neat stack, the top one ticked: nothing is due.
 * Drawn where the fan of cards sits when a session is ready.
 */
export function CardsDone({ scale = 1 }: { scale?: number }) {
  const green = strong("green");
  return (
    <span
      aria-hidden="true"
      className="relative block shrink-0"
      style={{ width: 74 * scale, height: 62 * scale }}
    >
      {[2, 1, 0].map((layer) => (
        <span
          key={layer}
          className="absolute grid place-items-center"
          style={{
            width: 38 * scale,
            height: 48 * scale,
            left: `calc(50% - ${19 * scale}px + ${layer * 6 * scale}px)`,
            bottom: 4 * scale + layer * 4 * scale,
            borderRadius: 7 * scale,
            border: `${1.5 * scale}px solid color-mix(in srgb, ${CANVAS} 90%, transparent)`,
            background:
              layer === 0
                ? mix("var(--color-surface)", green, 0.16, 0.26)
                : mix("var(--color-surface)", green, 0.06 + layer * 0.03, 0.1 + layer * 0.04),
            zIndex: 3 - layer,
          }}
        >
          {layer === 0 ? (
            <span
              className="grid place-items-center rounded-full"
              style={{ width: 22 * scale, height: 22 * scale, background: green }}
            >
              <Check size={14 * scale} strokeWidth={3} color="white" />
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** One tumbler, with water at `level` (0 to 1) and an optional count on it. */
function Glass({
  hue,
  level,
  big,
  count,
}: {
  hue: Hue;
  level: number;
  big?: boolean;
  count?: number;
}) {
  const w = big ? 34 : 15;
  const h = big ? 42 : 24;
  const top = big ? 3 : 2;
  const bottom = big ? 9 : 5;
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden"
      style={{
        width: w,
        height: h,
        borderRadius: `${top}px ${top}px ${bottom}px ${bottom}px`,
        background: mix(CANVAS, strong(hue), 0.03, 0.06),
        border: `1.2px solid ${mix(CANVAS, strong(hue), 0.45, 0.55)}`,
      }}
    >
      <span
        className="absolute inset-x-0 bottom-0"
        style={{ height: `${level * 100}%`, background: mix(CANVAS, strong(hue), 0.38, 0.5) }}
      />
      {count !== undefined ? (
        <span
          className="relative font-bold"
          style={{
            fontSize: 15,
            lineHeight: 1,
            color: `light-dark(${strong(hue)}, var(--color-foreground))`,
          }}
        >
          {count}
        </span>
      ) : null}
    </span>
  );
}

/** Links waiting to be read, blue glasses full, those on their last chance amber and low. */
export function LinkGlasses({ waiting, expiring }: { waiting: number; expiring: number }) {
  const total = waiting + expiring;
  return (
    <span aria-hidden="true" className="flex items-end" style={{ gap: total > 5 ? 6 : 4 }}>
      {total === 0 ? (
        <Glass hue="blue" level={0} />
      ) : total <= 5 ? (
        <>
          {Array.from({ length: waiting }, (_, index) => (
            <Glass key={`w${index}`} hue="blue" level={0.85} />
          ))}
          {Array.from({ length: expiring }, (_, index) => (
            <Glass key={`e${index}`} hue="amber" level={0.12} />
          ))}
        </>
      ) : (
        <>
          {waiting > 0 ? <Glass hue="blue" level={0.85} big count={waiting} /> : null}
          {expiring > 0 ? <Glass hue="amber" level={0.14} big count={expiring} /> : null}
        </>
      )}
    </span>
  );
}

/** The question decks, as a small fan of violet cards. Grey and single with none. */
export function DeckFan({ decks }: { decks: number }) {
  const n = Math.max(1, Math.min(5, decks));
  return (
    <span aria-hidden="true" className="relative block" style={{ width: 56, height: 44 }}>
      {Array.from({ length: n }, (_, index) => {
        const { p, d } = fanPosition(index, n);
        return (
          <span
            key={index}
            className="absolute"
            style={{
              width: 22,
              height: 31,
              left: "calc(50% - 11px)",
              bottom: 3,
              borderRadius: 4,
              border: `1.2px solid ${CANVAS}`,
              transform: `translateX(${p * 9}px) rotate(${p * 0.28}rad)`,
              transformOrigin: "bottom center",
              background:
                decks === 0
                  ? "var(--color-border)"
                  : mix(CANVAS, strong("violet"), 0.16 + 0.55 * d, 0.25 + 0.55 * d),
            }}
          />
        );
      })}
    </span>
  );
}

/** The streak: a flame and the number of days, grey with no streak. */
export function StreakFlame({ days }: { days: number }) {
  const lit = days > 0;
  return (
    <span
      aria-hidden="true"
      className="flex items-center gap-0.5"
      style={{ color: lit ? strong("orange") : "var(--color-subtle-foreground)" }}
    >
      <Flame size={30} strokeWidth={2} />
      {lit ? (
        <span className="font-display" style={{ fontSize: 26, fontWeight: 650, lineHeight: 1 }}>
          {days}
        </span>
      ) : null}
    </span>
  );
}

/** Cards due on each of the next days, today's bar solid. */
export function DayBars({
  days,
  height = 110,
  label,
}: {
  days: { day: string; count: number }[];
  height?: number;
  label: string;
}) {
  const peak = Math.max(1, ...days.map((row) => row.count));
  const few = days.length <= 7;
  return (
    <div className="flex items-end" role="img" aria-label={label} style={{ height }}>
      {days.map((row, index) => {
        const share = Math.min(1, Math.max(0.04, row.count / peak));
        return (
          <div
            key={row.day}
            className="flex h-full flex-1 flex-col items-stretch justify-end"
            style={{ paddingInline: few ? 5 : 1.5 }}
          >
            {few ? (
              <span className="text-center text-[11px] font-semibold tabular-nums">
                {row.count}
              </span>
            ) : null}
            <span
              className="mt-1 rounded-md"
              style={{
                height: `calc((100% - 2.5rem) * ${share})`,
                minHeight: 3,
                background:
                  index === 0
                    ? "var(--color-primary)"
                    : "color-mix(in srgb, var(--color-primary) 28%, transparent)",
              }}
            />
            {few ? (
              <span className="text-muted-foreground mt-1.5 text-center text-[11px] font-semibold">
                {index === 0 ? "Today" : weekday(row.day)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function weekday(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });
}

/** A site's first letter on a wash of its colour, as the phone marks a link's source. */
export function SiteMark({
  url,
  siteName,
  size = 30,
  className,
}: {
  url: string;
  siteName?: string | null;
  size?: number;
  className?: string;
}) {
  const key = siteKey(url, siteName);
  const hue = hueFor(key);
  const letter =
    (siteName ?? key)
      .replace(/^www\./, "")
      .charAt(0)
      .toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={cx("grid shrink-0 place-items-center font-bold", className)}
      style={{
        width: size,
        height: size,
        borderRadius: size >= 36 ? 10 : 9,
        background: soft(hue),
        color: strong(hue),
        fontSize: size >= 36 ? 16 : 14,
      }}
    >
      {letter}
    </span>
  );
}

const DIFFICULTY: Record<string, { filled: number; hue: Hue }> = {
  easy: { filled: 1, hue: "green" },
  medium: { filled: 2, hue: "amber" },
  hard: { filled: 3, hue: "red" },
};

/** Three rising bars and the word, as the phone marks how hard a question is. */
export function DifficultyMark({ level }: { level: string }) {
  const known = DIFFICULTY[level.toLowerCase()] ?? { filled: 2, hue: "amber" as Hue };
  const color = strong(known.hue);
  return (
    <span className="inline-flex items-end gap-1.5" style={{ color }}>
      <span aria-hidden="true" className="flex items-end gap-0.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="rounded-[1px]"
            style={{
              width: 3.5,
              height: 5 + 3.5 * index,
              background: index < known.filled ? color : "var(--color-border)",
            }}
          />
        ))}
      </span>
      <span className="text-[13px] font-semibold leading-none">{level.toLowerCase()}</span>
    </span>
  );
}

/**
 * An inbox row's mark: the site's letter in a small glass whose water is the link's life
 * left. It drains as the link is put off, and turns amber near the end. A link that does
 * not expire (read, dropped, or expiry off) gets the plain letter mark.
 */
export function LifeMark({
  url,
  siteName,
  lifeLeft,
}: {
  url: string;
  siteName?: string | null;
  lifeLeft: number | null;
}) {
  if (lifeLeft === null) return <SiteMark url={url} siteName={siteName} />;
  const key = siteKey(url, siteName);
  const hue = hueFor(key);
  const water: Hue = lifeLeft < 0.25 ? "amber" : hue;
  const letter =
    (siteName ?? key)
      .replace(/^www\./, "")
      .charAt(0)
      .toUpperCase() || "?";
  const card = "var(--color-surface)";
  return (
    <span
      aria-hidden="true"
      className="relative grid size-[30px] shrink-0 place-items-center overflow-hidden rounded-[9px] text-[14px] font-bold"
      style={{
        background: mix(card, strong(hue), 0.03, 0.06),
        border: `1px solid ${mix(card, strong(hue), 0.35, 0.45)}`,
        color: strong(hue),
      }}
    >
      <span
        className="life-water absolute inset-x-[-4px] bottom-0"
        style={{
          height: `${Math.max(0, Math.min(1, lifeLeft)) * 100}%`,
          background: mix(card, strong(water), 0.2, 0.28),
          boxShadow: `inset 0 3px 0 ${mix(card, strong(water), 0.34, 0.46)}`,
        }}
      />
      <span className="relative">{letter}</span>
    </span>
  );
}

/** A card's outline drawn in dashes: a deck still to be made, or one with no questions. */
export function DashedCard({
  color,
  width = 30,
  height = 40,
  children,
}: {
  color: string;
  width?: number;
  height?: number;
  children?: React.ReactNode;
}) {
  return (
    <span className="relative grid place-items-center" style={{ width, height, color }}>
      <svg
        aria-hidden="true"
        className="absolute inset-0"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <rect
          x="0.7"
          y="0.7"
          width={width - 1.4}
          height={height - 1.4}
          rx="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeDasharray="4 3"
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

const DECK_ICONS = { resume: IdCard, document: BookOpen, manual: NotebookPen, topics: Lightbulb };

/**
 * A deck as a small stack of cards in its own colour: thicker with more questions, the
 * top card filled from the bottom as far as the deck is learned.
 */
export function DeckStack({
  id,
  kind,
  total,
  learned,
  scale = 1,
}: {
  id: string;
  kind: string;
  total: number;
  learned: number;
  scale?: number;
}) {
  const hue = hueFor(id);
  const Icon = DECK_ICONS[kind as keyof typeof DECK_ICONS] ?? Lightbulb;
  const s = (value: number): number => value * scale;
  if (total === 0) {
    return (
      <span
        aria-hidden="true"
        className="grid shrink-0 place-items-center"
        style={{ width: s(40), height: s(48) }}
      >
        <DashedCard color={mix(CANVAS, strong(hue), 0.4, 0.5)} width={s(30)} height={s(40)}>
          <span style={{ color: mix(CANVAS, strong(hue), 0.5, 0.6) }}>
            <Icon size={s(14)} />
          </span>
        </DashedCard>
      </span>
    );
  }
  const layers = Math.max(1, Math.min(5, total));
  return (
    <span
      aria-hidden="true"
      className="relative block shrink-0"
      style={{ width: s(40), height: s(48) }}
    >
      {Array.from({ length: layers - 1 }, (_, j) => (
        <span
          key={j}
          className="absolute"
          style={{
            left: s(2 * (layers - 1 - j)),
            bottom: s(2 * j),
            width: s(30),
            height: s(40),
            borderRadius: s(6),
            background: mix(CANVAS, strong(hue), 0.1, 0.16),
            border: `${1.2 * scale}px solid ${CANVAS}`,
          }}
        />
      ))}
      <span
        className="absolute grid place-items-center overflow-hidden"
        style={{
          left: 0,
          bottom: s(2 * (layers - 1)),
          width: s(30),
          height: s(40),
          borderRadius: s(6),
          background: mix(CANVAS, strong(hue), 0.04, 0.08),
          border: `${1.2 * scale}px solid ${mix(CANVAS, strong(hue), 0.5, 0.6)}`,
          color: strong(hue),
        }}
      >
        <span
          className="absolute inset-x-0 bottom-0"
          style={{
            height: `${(learned / total) * 100}%`,
            background: mix(CANVAS, strong(hue), 0.36, 0.5),
          }}
        />
        <span className="relative">
          <Icon size={s(15)} />
        </span>
      </span>
    </span>
  );
}

/** The average written score as a ring that fills clockwise from twelve. */
export function ScoreRing({ score }: { score: number | null }) {
  const color =
    score === null
      ? "var(--color-subtle-foreground)"
      : score < 50
        ? "var(--color-danger)"
        : score < 75
          ? "var(--color-warning)"
          : "var(--color-success)";
  const r = 23.5;
  const length = 2 * Math.PI * r;
  return (
    <span aria-hidden="true" className="relative grid size-[52px] place-items-center">
      <svg width="52" height="52" viewBox="0 0 52 52" className="absolute inset-0 -rotate-90">
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--color-border)" strokeWidth="5" />
        {score !== null ? (
          <circle
            cx="26"
            cy="26"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * length} ${length}`}
          />
        ) : null}
      </svg>
      <span className="font-display relative text-[19px] font-[680] leading-none" style={{ color }}>
        {score ?? "-"}
      </span>
    </span>
  );
}

/** One dot per day, filled on the days something was reviewed; today is ringed. */
export function ActiveDots({ days }: { days: { count: number }[] }) {
  return (
    <span aria-hidden="true" className="grid w-[97px] grid-cols-10 gap-[3px]">
      {days.map((day, index) => (
        <span
          key={index}
          className="size-[7px] rounded-full"
          style={{
            background: day.count > 0 ? "var(--color-primary)" : "var(--color-border)",
            boxShadow: index === days.length - 1 ? "0 0 0 1.5px var(--color-primary)" : undefined,
          }}
        />
      ))}
    </span>
  );
}

/** One bar per day, the peak's count above it, start and end dates under it. */
export function StatsBars({
  days,
  highlight,
  startLabel,
  endLabel,
  label,
}: {
  days: { day: string; count: number }[];
  highlight: "first" | "last";
  startLabel: string;
  endLabel: string;
  label: string;
}) {
  const peak = Math.max(0, ...days.map((row) => row.count));
  const peakIndex = days.findIndex((row) => row.count === peak && peak > 0);
  const marked = highlight === "first" ? 0 : days.length - 1;
  return (
    <div role="img" aria-label={label}>
      <div className="flex h-24 items-end" style={{ gap: days.length > 20 ? 2 : 4 }}>
        {days.map((row, index) => (
          <div key={row.day} className="relative flex h-full flex-1 flex-col justify-end">
            {index === peakIndex ? (
              <span
                className="absolute inset-x-[-8px] text-center text-xs font-semibold tabular-nums"
                style={{
                  bottom: `calc(${Math.max(0.04, row.count / Math.max(1, peak)) * 100}% + 2px)`,
                }}
              >
                {row.count}
              </span>
            ) : null}
            <span
              className="rounded-[3px]"
              style={{
                height: `${Math.min(1, Math.max(0.04, peak === 0 ? 0.04 : row.count / peak)) * 100}%`,
                background:
                  row.count === 0
                    ? "var(--color-border)"
                    : index === marked
                      ? "var(--color-primary)"
                      : "color-mix(in srgb, var(--color-primary) 35%, transparent)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-1.5 flex justify-between text-xs">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

/** Parts of a whole as one rounded bar, each part its own colour. */
export function SplitBar({
  parts,
  height = 10,
}: {
  parts: { value: number; color: string }[];
  height?: number;
}) {
  const shown = parts.filter((part) => part.value > 0);
  if (shown.length === 0) {
    return <span aria-hidden="true" className="bg-border block rounded-full" style={{ height }} />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex overflow-hidden rounded-full"
      style={{ height, gap: 2 }}
    >
      {shown.map((part, index) => (
        <span key={index} style={{ flex: part.value, background: part.color }} />
      ))}
    </span>
  );
}

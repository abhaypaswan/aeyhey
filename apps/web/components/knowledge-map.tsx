"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The map: links and questions as one picture, clustered by the tags they share.
//
// Each tag that two or more things share becomes a hub, drawn in that tag's own colour,
// and the things sit around their hubs. Something with several tags is pulled between
// them, which is where the picture gets interesting: a hub that holds both links and
// questions is a bridge between what you read and what you are asked about.
//
// The layout is worked out once, with d3-force, and then it is a plain SVG: drag to pan,
// scroll or pinch to zoom, hover to see what a dot is, click to open it. Colour says how
// each thing stands (learned, due, weak, about to expire), so weak spots show at a glance.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { pluralize } from "../lib/format";
import { hueFor, soft, strong } from "../lib/hue";
import { cx } from "./ui";

export type ItemState =
  "waiting" | "expiring" | "done" | "new" | "due" | "learning" | "learned" | "weak";

export interface MapItem {
  id: string;
  kind: "link" | "question";
  title: string;
  href: string;
  /** The site a link is from, or the deck a question is in. */
  group: string;
  tags: string[];
  state: ItemState;
  score: number | null;
}

export interface MapData {
  items: MapItem[];
  decks: { id: string; name: string }[];
}

interface Node extends SimulationNodeDatum {
  id: string;
  type: "hub" | "link" | "question";
  item?: MapItem;
  tag?: string;
  links: number;
  questions: number;
}

type Edge = SimulationLinkDatum<Node> & { tag: string };

const STATE: Record<ItemState, { label: string; color: string }> = {
  waiting: { label: "Waiting to be read", color: strong("blue") },
  expiring: { label: "Last chance", color: strong("amber") },
  done: { label: "Read", color: "color-mix(in srgb, var(--color-success) 70%, transparent)" },
  new: { label: "Not asked yet", color: "var(--color-border-strong)" },
  due: { label: "Due", color: "var(--color-primary)" },
  learning: { label: "Learning", color: strong("violet") },
  learned: { label: "Learned", color: "var(--color-success)" },
  weak: { label: "Weak spot", color: "var(--color-danger)" },
};

const LEGEND: ItemState[] = [
  "due",
  "learning",
  "learned",
  "weak",
  "new",
  "waiting",
  "expiring",
  "done",
];

type Show = "all" | "links" | "questions";

/** A small seeded generator (a linear congruential one), for a repeatable layout. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hubRadius(node: Node): number {
  return 12 + Math.sqrt(node.links + node.questions) * 4;
}

/** Hubs for the tags two or more things share, items around them, worked out once. */
function layout(items: MapItem[]): { nodes: Node[]; edges: Edge[] } {
  const counts = new Map<string, { links: number; questions: number }>();
  for (const item of items) {
    for (const tag of item.tags) {
      const count = counts.get(tag) ?? { links: 0, questions: 0 };
      if (item.kind === "link") count.links += 1;
      else count.questions += 1;
      counts.set(tag, count);
    }
  }
  const shared = [...counts.entries()].filter(([, count]) => count.links + count.questions >= 2);
  const hubs: Node[] = shared.map(([tag, count]) => ({
    id: `tag:${tag}`,
    type: "hub",
    tag,
    links: count.links,
    questions: count.questions,
  }));
  const hubIds = new Set(hubs.map((hub) => hub.id));

  const itemNodes: Node[] = items.map((item) => ({
    id: item.id,
    type: item.kind,
    item,
    links: 0,
    questions: 0,
  }));

  const edges: Edge[] = [];
  for (const item of items) {
    for (const tag of item.tags) {
      if (hubIds.has(`tag:${tag}`)) edges.push({ source: item.id, target: `tag:${tag}`, tag });
    }
  }

  const nodes = [...hubs, ...itemNodes];
  // The same start every time, so the map does not rearrange itself between visits.
  nodes.forEach((node, index) => {
    const angle = index * 2.399963;
    const radius = 12 * Math.sqrt(index + 1);
    node.x = Math.cos(angle) * radius;
    node.y = Math.sin(angle) * radius;
  });

  forceSimulation(nodes)
    .force(
      "link",
      forceLink<Node, Edge>(edges)
        .id((node) => node.id)
        .distance((edge) => 34 + hubRadius(edge.target as Node) * 0.6)
        .strength(0.7),
    )
    .force(
      "charge",
      forceManyBody<Node>().strength((node) => (node.type === "hub" ? -340 : -38)),
    )
    .force(
      "collide",
      forceCollide<Node>().radius((node) => (node.type === "hub" ? hubRadius(node) + 24 : 9)),
    )
    .force("x", forceX(0).strength(0.045))
    .force("y", forceY(0).strength(0.06))
    // A fixed seed rather than Math.random, so the server and the browser lay out the
    // same map and the page hydrates cleanly.
    .randomSource(seededRandom(7))
    .stop()
    .tick(400);

  // Rounded, because the server and the browser can still differ in the last digits.
  for (const node of nodes) {
    node.x = Math.round((node.x ?? 0) * 10) / 10;
    node.y = Math.round((node.y ?? 0) * 10) / 10;
  }

  return { nodes, edges };
}

export function KnowledgeMap({
  data,
  embedded = false,
}: {
  data: MapData;
  /** Drawn as a section of Home rather than as a page of its own. */
  embedded?: boolean;
}) {
  const { nodes, edges } = useMemo(() => layout(data.items), [data.items]);

  const [show, setShow] = useState<Show>("all");
  const [weakOnly, setWeakOnly] = useState(false);
  const [focusTag, setFocusTag] = useState<string | null>(null);
  const [hover, setHover] = useState<{ node: Node; x: number; y: number } | null>(null);

  // The visible area, in map units, which pan and zoom move.
  const bounds = useMemo(() => {
    const xs = nodes.map((node) => node.x ?? 0);
    const ys = nodes.map((node) => node.y ?? 0);
    const pad = 70;
    const minX = Math.min(0, ...xs) - pad;
    const minY = Math.min(0, ...ys) - pad;
    return {
      x: minX,
      y: minY,
      w: Math.max(...xs, 0) + pad - minX,
      h: Math.max(...ys, 0) + pad - minY,
    };
  }, [nodes]);
  const [view, setView] = useState(bounds);
  useEffect(() => setView(bounds), [bounds]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; view: typeof view } | null>(null);

  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      setView((current) => {
        const cx = at?.x ?? current.x + current.w / 2;
        const cy = at?.y ?? current.y + current.h / 2;
        const w = Math.min(Math.max(current.w * factor, 120), bounds.w * 3);
        const h = (w / current.w) * current.h;
        return {
          x: cx - ((cx - current.x) * w) / current.w,
          y: cy - ((cy - current.y) * h) / current.h,
          w,
          h,
        };
      });
    },
    [bounds.w],
  );

  // The wheel zooms around the pointer. Attached by hand because React's onWheel is
  // passive, and the page must not scroll while the map is zoomed.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent): void => {
      // Inside Home the wheel scrolls the page; zooming takes Cmd or Ctrl, which is also
      // what a trackpad pinch sends.
      if (embedded && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      setView((current) => {
        const at = {
          x: current.x + ((event.clientX - rect.left) / rect.width) * current.w,
          y: current.y + ((event.clientY - rect.top) / rect.height) * current.h,
        };
        const factor = Math.exp(event.deltaY * 0.0015);
        const w = Math.min(Math.max(current.w * factor, 120), bounds.w * 3);
        const h = (w / current.w) * current.h;
        return {
          x: at.x - ((at.x - current.x) * w) / current.w,
          y: at.y - ((at.y - current.y) * h) / current.h,
          w,
          h,
        };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [bounds.w, embedded]);

  // What is lit: everything, or what the filters leave. The rest fades but stays, so the
  // shape of the whole is never lost.
  const lit = useMemo(() => {
    const on = new Set<string>();
    for (const node of nodes) {
      if (node.type === "hub") continue;
      const item = node.item!;
      if (show === "links" && item.kind !== "link") continue;
      if (show === "questions" && item.kind !== "question") continue;
      if (weakOnly && item.state !== "weak" && item.state !== "expiring") continue;
      if (focusTag && !item.tags.includes(focusTag)) continue;
      on.add(node.id);
    }
    for (const edge of edges) {
      const source = edge.source as Node;
      if (on.has(source.id)) on.add((edge.target as Node).id);
    }
    if (focusTag) on.add(`tag:${focusTag}`);
    return on;
  }, [nodes, edges, show, weakOnly, focusTag]);

  const hovered = hover?.node ?? null;
  const neighbours = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered.id]);
    for (const edge of edges) {
      const source = edge.source as Node;
      const target = edge.target as Node;
      if (source.id === hovered.id) set.add(target.id);
      if (target.id === hovered.id) set.add(source.id);
    }
    return set;
  }, [hovered, edges]);

  const isLit = (id: string): boolean => lit.has(id) && (!neighbours || neighbours.has(id));

  const hubs = nodes.filter((node) => node.type === "hub");
  const bridges = hubs
    .filter((hub) => hub.links > 0 && hub.questions > 0)
    .sort((a, b) => b.links + b.questions - (a.links + a.questions));
  const linkCount = data.items.filter((item) => item.kind === "link").length;
  const questionCount = data.items.length - linkCount;
  const weakCount = data.items.filter((item) => item.state === "weak").length;

  function pointAt(event: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: view.x + ((event.clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((event.clientY - rect.top) / rect.height) * view.h,
    };
  }

  if (data.items.length === 0) {
    if (embedded) {
      return (
        <section
          aria-label="Your map"
          className="map-canvas flex h-56 items-center justify-center rounded-[22px] px-6"
        >
          <p className="text-muted-foreground max-w-md text-center text-[15px] leading-[1.45]">
            Your map starts here. Save a link or make a deck, and it shows up, grouped by subject,
            with lines wherever your reading and your questions meet.
          </p>
        </section>
      );
    }
    return (
      <main className="mx-auto w-full max-w-6xl px-[22px] pb-16 pt-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-[30px] font-[640] leading-[1.1] lg:text-4xl">Map</h1>
        <p className="text-muted-foreground mt-3 max-w-xl text-[15px] leading-[1.45]">
          Save a few links or make a deck, and they show up here, grouped by subject, with lines
          wherever your reading and your questions meet.
        </p>
      </main>
    );
  }

  const Outer = embedded ? "section" : "main";
  return (
    <Outer
      {...(embedded ? { "aria-label": "Your map" } : {})}
      className={cx(
        "grid w-full gap-6",
        embedded
          ? "lg:grid-cols-[minmax(0,1fr)_19rem]"
          : "mx-auto max-w-[110rem] flex-1 px-4 pb-8 pt-2 sm:px-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:px-8 lg:pt-4",
      )}
    >
      <section
        aria-label="Map of your links and questions"
        className={cx(
          "map-canvas relative overflow-hidden rounded-[22px]",
          embedded ? "h-[36rem]" : "min-h-[60dvh] lg:h-[calc(100dvh-6.5rem)] lg:min-h-0",
        )}
      >
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="size-full cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={(event) => {
            (event.target as Element).setPointerCapture?.(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, view };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const rect = svgRef.current!.getBoundingClientRect();
            const start = drag.current;
            setView({
              ...start.view,
              x: start.view.x - ((event.clientX - start.x) / rect.width) * start.view.w,
              y: start.view.y - ((event.clientY - start.y) / rect.height) * start.view.h,
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onDoubleClick={(event) => zoomBy(0.6, pointAt(event as unknown as React.PointerEvent))}
        >
          <g>
            {edges.map((edge, index) => {
              const source = edge.source as Node;
              const target = edge.target as Node;
              const on = isLit(source.id) && isLit(target.id);
              return (
                <line
                  key={index}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={strong(hueFor(edge.tag))}
                  strokeWidth={on && neighbours ? 1.6 : 1}
                  strokeOpacity={on ? (neighbours ? 0.7 : 0.28) : 0.05}
                />
              );
            })}
          </g>

          <g>
            {hubs.map((hub) => {
              const hue = hueFor(hub.tag!);
              const r = hubRadius(hub);
              const bridge = hub.links > 0 && hub.questions > 0;
              const on = isLit(hub.id);
              return (
                <g
                  key={hub.id}
                  transform={`translate(${hub.x} ${hub.y})`}
                  opacity={on ? 1 : 0.15}
                  className="cursor-pointer"
                  role="button"
                  aria-label={`#${hub.tag}: ${hub.links} links, ${hub.questions} questions`}
                  onPointerEnter={(event) =>
                    setHover({ node: hub, x: event.clientX, y: event.clientY })
                  }
                  onPointerLeave={() => setHover(null)}
                  onClick={() => setFocusTag((current) => (current === hub.tag ? null : hub.tag!))}
                >
                  {bridge ? (
                    <circle
                      r={r + 5}
                      fill="none"
                      stroke={strong(hue)}
                      strokeOpacity={0.35}
                      strokeDasharray="3 3"
                    />
                  ) : null}
                  <circle
                    r={r}
                    fill={soft(hue)}
                    stroke={strong(hue)}
                    strokeWidth={focusTag === hub.tag ? 3 : 1.5}
                  />
                  <text
                    y={r + 15}
                    textAnchor="middle"
                    className="font-display"
                    style={{ fontSize: 12.5, fontWeight: 620, fill: strong(hue) }}
                  >
                    #{hub.tag}
                  </text>
                </g>
              );
            })}
          </g>

          <g>
            {nodes
              .filter((node) => node.type !== "hub")
              .map((node) => {
                const item = node.item!;
                const on = isLit(node.id);
                const color = STATE[item.state].color;
                return (
                  <a
                    key={node.id}
                    href={item.href}
                    aria-label={`${item.kind === "link" ? "Link" : "Question"}: ${item.title}`}
                    onPointerEnter={(event) =>
                      setHover({ node, x: event.clientX, y: event.clientY })
                    }
                    onPointerMove={(event) =>
                      setHover((current) =>
                        current ? { ...current, x: event.clientX, y: event.clientY } : current,
                      )
                    }
                    onPointerLeave={() => setHover(null)}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <g transform={`translate(${node.x} ${node.y})`} opacity={on ? 1 : 0.12}>
                      {item.kind === "link" ? (
                        <circle
                          r={hovered?.id === node.id ? 8.5 : 6.5}
                          fill={color}
                          stroke="var(--color-surface)"
                          strokeWidth={1.5}
                        />
                      ) : (
                        <rect
                          x={-5.5}
                          y={-7}
                          width={11}
                          height={14}
                          rx={2.5}
                          fill={item.state === "new" ? "var(--color-surface)" : color}
                          stroke={item.state === "new" ? color : "var(--color-surface)"}
                          strokeWidth={1.5}
                          strokeDasharray={item.state === "new" ? "2.5 2" : undefined}
                          transform={hovered?.id === node.id ? "scale(1.3)" : undefined}
                        />
                      )}
                    </g>
                  </a>
                );
              })}
          </g>
        </svg>

        {hover ? <HoverCard node={hover.node} x={hover.x} y={hover.y} /> : null}

        <div className="map-tools absolute bottom-3 right-3 flex items-center gap-1 rounded-full p-1">
          <SdkButton aria-label="Zoom in" onClick={() => zoomBy(0.75)} className="map-tool">
            <Plus size={16} aria-hidden="true" />
          </SdkButton>
          <SdkButton aria-label="Zoom out" onClick={() => zoomBy(1.33)} className="map-tool">
            <Minus size={16} aria-hidden="true" />
          </SdkButton>
          <SdkButton
            aria-label="Fit the whole map"
            onClick={() => setView(bounds)}
            className="map-tool"
          >
            <RotateCcw size={15} aria-hidden="true" />
          </SdkButton>
        </div>
        <p className="text-muted-foreground pointer-events-none absolute left-4 top-3 hidden text-xs lg:block">
          {embedded
            ? "Drag to move, pinch or Cmd and scroll to zoom, click a subject to focus it"
            : "Drag to move, scroll to zoom, click a subject to focus it"}
        </p>
      </section>

      <aside
        className={cx(
          "flex min-w-0 flex-col gap-6",
          embedded
            ? "lg:h-[36rem] lg:overflow-y-auto lg:pr-1"
            : "lg:h-[calc(100dvh-6.5rem)] lg:overflow-y-auto lg:pr-1",
        )}
      >
        <div>
          {embedded ? (
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl font-[640]">Your map</h2>
              <a href="/map" className="text-primary text-sm font-semibold hover:underline">
                Full screen
              </a>
            </div>
          ) : (
            <h1 className="font-display text-[30px] font-[640] leading-[1.1]">Map</h1>
          )}
          <p className="text-muted-foreground mt-2 text-[15px] leading-[1.45]">
            {pluralize(questionCount, "question")} and {pluralize(linkCount, "link")} across{" "}
            {pluralize(hubs.length, "subject")}.{" "}
            {bridges.length > 0
              ? `${bridges.length} ${bridges.length === 1 ? "subject joins" : "subjects join"} what you read to what you are asked.`
              : ""}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <SegmentedControl
            aria-label="Show"
            value={show}
            onValueChange={(next) => next && setShow(next as Show)}
            className="pill-segments"
          >
            <SegmentedControlIndicator />
            <SegmentedControlItem value="all">Everything</SegmentedControlItem>
            <SegmentedControlItem value="links">Links</SegmentedControlItem>
            <SegmentedControlItem value="questions">Questions</SegmentedControlItem>
          </SegmentedControl>
          <label className="flex items-center justify-between gap-3 text-[14.5px]">
            <span>
              Only weak spots
              <span className="text-muted-foreground block text-xs">
                {weakCount} weak {weakCount === 1 ? "answer" : "answers"}, and links on their last
                chance
              </span>
            </span>
            <Switch checked={weakOnly} onCheckedChange={setWeakOnly}>
              <SwitchThumb />
            </Switch>
          </label>
          {focusTag ? (
            <SdkButton
              onClick={() => setFocusTag(null)}
              className="quiet-chip self-start"
              style={{ color: strong(hueFor(focusTag)) }}
            >
              #{focusTag} · show everything
            </SdkButton>
          ) : null}
        </div>

        {bridges.length > 0 ? (
          <section aria-label="Bridges">
            <h2 className="font-display text-[17px] font-[640]">Where reading meets questions</h2>
            <ul className="mt-2">
              {bridges.slice(0, 8).map((hub, index) => (
                <li key={hub.id}>
                  <SdkButton
                    onClick={() =>
                      setFocusTag((current) => (current === hub.tag ? null : hub.tag!))
                    }
                    className={cx(
                      "flex w-full items-center gap-3 py-2.5 text-left",
                      index > 0 && "border-border border-t-[0.5px]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: strong(hueFor(hub.tag!)) }}
                    />
                    <span
                      className={cx(
                        "flex-1 text-[14.5px] font-semibold",
                        focusTag === hub.tag && "underline",
                      )}
                      style={{ color: strong(hueFor(hub.tag!)) }}
                    >
                      #{hub.tag}
                    </span>
                    <span className="text-muted-foreground text-[13px]">
                      {hub.links} {hub.links === 1 ? "link" : "links"} · {hub.questions}{" "}
                      {hub.questions === 1 ? "question" : "questions"}
                    </span>
                  </SdkButton>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="What the colours mean">
          <h2 className="font-display text-[17px] font-[640]">Key</h2>
          <div className="text-muted-foreground mt-2 flex flex-col gap-1 text-[13px]">
            <span className="flex items-center gap-2.5">
              <svg width="14" height="14" aria-hidden="true">
                <circle cx="7" cy="7" r="5.5" fill={strong("blue")} />
              </svg>
              A link
              <svg width="14" height="14" aria-hidden="true" className="ml-3">
                <rect x="2.5" y="1" width="9" height="12" rx="2" fill="var(--color-primary)" />
              </svg>
              A question
            </span>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {LEGEND.map((state) => (
              <li key={state} className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{
                    background: state === "new" ? "transparent" : STATE[state].color,
                    border: state === "new" ? `1.5px dashed ${STATE[state].color}` : undefined,
                  }}
                />
                {STATE[state].label}
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </Outer>
  );
}

function HoverCard({ node, x, y }: { node: Node; x: number; y: number }) {
  const card = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState({ left: x + 14, top: y + 14 });
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setPlace({
      left: x + 14 + width > window.innerWidth - 8 ? x - width - 14 : x + 14,
      top: y + 14 + height > window.innerHeight - 8 ? y - height - 14 : y + 14,
    });
  }, [x, y]);

  if (node.type === "hub") {
    return (
      <div
        ref={card}
        className="map-card pointer-events-none fixed z-50 max-w-72 rounded-2xl px-3.5 py-2.5"
        style={place}
      >
        <p
          className="font-display text-[15px] font-semibold"
          style={{ color: strong(hueFor(node.tag!)) }}
        >
          #{node.tag}
        </p>
        <p className="text-muted-foreground text-[13px]">
          {node.links} {node.links === 1 ? "link" : "links"}, {node.questions}{" "}
          {node.questions === 1 ? "question" : "questions"}
        </p>
      </div>
    );
  }
  const item = node.item!;
  return (
    <div
      ref={card}
      className="map-card pointer-events-none fixed z-50 max-w-80 rounded-2xl px-3.5 py-3"
      style={place}
    >
      <p className="text-muted-foreground text-xs">
        {item.kind === "link" ? "Link" : "Question"} · {item.group}
      </p>
      <p className="font-display mt-1 line-clamp-3 text-[15.5px] font-[560] leading-[1.25]">
        {item.title}
      </p>
      <p
        className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold"
        style={{ color: STATE[item.state].color }}
      >
        {STATE[item.state].label}
        {item.score !== null ? (
          <span className="text-muted-foreground font-normal">· last answer {item.score}/100</span>
        ) : null}
      </p>
      {item.tags.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap gap-x-2 text-xs font-semibold">
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag} style={{ color: strong(hueFor(tag)) }}>
              #{tag}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

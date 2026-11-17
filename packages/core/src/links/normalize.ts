// SPDX-License-Identifier: AGPL-3.0-only
// URL normalization (PRD 8.1 FR-LINK-1).
//
// The job is to decide when two URLs are the same saved thing, so the same article
// pasted from a newsletter, a tweet and a Google result all land on one link. We are
// deliberately aggressive about tracking parameters and conservative about anything that
// could change what the page shows: dropping a real query parameter would silently save
// the wrong page.

const TRACKING_PREFIXES = ["utm_", "mc_", "pk_", "ga_", "hsa_", "vero_", "_hs"];

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "referrer",
  "source",
  "mkt_tok",
  "yclid",
  "_ga",
  "_gl",
  "trk",
  "trkCampaign",
  "sc_channel",
  "sc_campaign",
  "ck_subscriber_id",
  "spm",
  "scid",
]);

/** Hosts where extra parameters are pure tracking and safe to drop. */
const HOST_SPECIFIC_DROPS: Record<string, string[]> = {
  "x.com": ["s", "t", "cxt", "mx"],
  "youtube.com": ["feature", "ab_channel", "pp", "si", "kw"],
  "medium.com": ["sk", "source"],
  "linkedin.com": ["trackingId", "lipi", "licu", "trk"],
  "reddit.com": ["share_id", "rdt", "context"],
  "github.com": ["tab"],
  "amazon.com": ["pd_rd_i", "pd_rd_r", "pd_rd_w", "pf_rd_p", "pf_rd_r", "psc", "th"],
};

/** Hosts we rewrite to one canonical form. */
const HOST_ALIASES: Record<string, string> = {
  "twitter.com": "x.com",
  "mobile.twitter.com": "x.com",
  "m.twitter.com": "x.com",
  "nitter.net": "x.com",
  "m.youtube.com": "youtube.com",
  "music.youtube.com": "youtube.com",
  "old.reddit.com": "reddit.com",
  "np.reddit.com": "reddit.com",
};

export interface NormalizedUrl {
  /** What the user pasted, trimmed and with a scheme. Shown and opened. */
  url: string;
  /** The dedupe key. Never shown. */
  normalized: string;
  host: string;
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function isTracking(key: string, host: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAMS.has(key) || TRACKING_PARAMS.has(lower)) return true;
  if (TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  const hostDrops = HOST_SPECIFIC_DROPS[host];
  return Boolean(hostDrops?.includes(key));
}

/** youtu.be/ID and /shorts/ID and /embed/ID all mean watch?v=ID. */
function canonicalYouTube(url: URL): URL {
  const videoId =
    url.hostname === "youtu.be"
      ? url.pathname.slice(1).split("/")[0]
      : (/^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] ??
        (url.pathname === "/watch" ? url.searchParams.get("v") : null));

  if (!videoId) return url;

  const next = new URL("https://youtube.com/watch");
  next.searchParams.set("v", videoId);
  // A timestamp changes where the video starts, so it is content, not tracking.
  const start = url.searchParams.get("t") ?? url.searchParams.get("start");
  if (start && url.hostname !== "youtu.be") next.searchParams.set("t", start);
  return next;
}

export function normalizeUrl(input: string): NormalizedUrl | null {
  const trimmed = input.trim().replace(/[),.;'"\]]+$/, "");
  if (trimmed === "") return null;

  // Any scheme already present decides the answer, and we have to spot a schemeless one
  // like mailto: or javascript: too, or prepending https:// would quietly turn it into a
  // link to the domain. Two things separate a real scheme from "example.com:8080":
  // a scheme has no dot in it, and what follows the colon is either // or not a digit.
  const schemeMatch = /^([a-z][a-z0-9+-]*):(\/\/)?/i.exec(trimmed);
  const hasScheme =
    schemeMatch !== null &&
    (schemeMatch[2] !== undefined || !/^\d/.test(trimmed.slice(schemeMatch[0].length)));

  if (hasScheme) {
    const scheme = schemeMatch[1]!.toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
  }

  // A bare domain is a reasonable thing to paste, so assume https.
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "" || !url.hostname.includes(".")) return null;
  // Credentials in a URL are refused for the same reason the SSRF guard refuses them:
  // they are almost always a mistake, and never something we want to store or replay.
  if (url.username !== "" || url.password !== "") return null;

  let host = stripWww(url.hostname.toLowerCase());
  host = HOST_ALIASES[host] ?? host;

  // A non-default port is part of the address, so it stays in the dedupe key. Self-hosters
  // save plenty of http://box.local:8080 style links.
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  let authority = url.port && url.port !== defaultPort ? `${host}:${url.port}` : host;

  if (host === "youtube.com" || url.hostname.toLowerCase() === "youtu.be") {
    const canonical = canonicalYouTube(
      new URL(
        url.toString().replace(url.hostname, url.hostname === "youtu.be" ? "youtu.be" : host),
      ),
    );
    url = canonical;
    host = "youtube.com";
    authority = "youtube.com";
  }

  const normalized = new URL(`https://${authority}`);
  normalized.pathname = url.pathname;
  normalized.hash = "";

  for (const [key, value] of url.searchParams) {
    if (!isTracking(key, host)) normalized.searchParams.append(key, value);
  }
  // A stable parameter order means ?a=1&b=2 and ?b=2&a=1 dedupe together.
  normalized.searchParams.sort();

  // Trailing slash carries no meaning, except on the bare root.
  if (normalized.pathname.length > 1 && normalized.pathname.endsWith("/")) {
    normalized.pathname = normalized.pathname.replace(/\/+$/, "");
  }

  // x.com status URLs: everything after the id is noise.
  const statusMatch = /^\/([^/]+)\/status(?:es)?\/(\d+)/.exec(normalized.pathname);
  if (host === "x.com" && statusMatch) {
    normalized.pathname = `/${statusMatch[1]!.toLowerCase()}/status/${statusMatch[2]}`;
    normalized.search = "";
  }

  return {
    url: url.toString(),
    normalized: normalized.toString(),
    host,
  };
}

export function sameLink(a: string, b: string): boolean {
  const left = normalizeUrl(a);
  const right = normalizeUrl(b);
  return Boolean(left && right && left.normalized === right.normalized);
}

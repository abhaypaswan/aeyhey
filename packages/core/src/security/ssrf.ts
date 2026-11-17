// SPDX-License-Identifier: AGPL-3.0-only
// SSRF protection for link fetching (PRD 17).
//
// Aeyhey fetches URLs a user pasted, so a pasted URL must not be able to reach the host's
// own network. The rules:
//   - http and https only
//   - resolve DNS first, then check every resolved address against the blocked ranges
//   - recheck after every redirect, because a public host can redirect to 169.254.169.254
//   - cap the response size and the time spent
// FETCH_ALLOW_PRIVATE=true turns the address check off, for people who really do want to
// save pages from their own LAN. The app logs a warning when it is on.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedUrlError extends Error {
  readonly code = "blocked_url";
  constructor(
    readonly url: string,
    readonly detail: string,
  ) {
    super(`Aeyhey will not fetch ${url}: ${detail}`);
    this.name = "BlockedUrlError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** CIDR blocks from PRD 17, plus a few that belong in the same bucket. */
const BLOCKED_V4: ReadonlyArray<{ cidr: string; why: string }> = [
  { cidr: "0.0.0.0/8", why: "this host" },
  { cidr: "10.0.0.0/8", why: "a private network" },
  { cidr: "100.64.0.0/10", why: "a carrier private network" },
  { cidr: "127.0.0.0/8", why: "loopback" },
  { cidr: "169.254.0.0/16", why: "link-local, which includes cloud metadata" },
  { cidr: "172.16.0.0/12", why: "a private network" },
  { cidr: "192.0.0.0/24", why: "a reserved range" },
  { cidr: "192.0.2.0/24", why: "a documentation range" },
  { cidr: "192.168.0.0/16", why: "a private network" },
  { cidr: "198.18.0.0/15", why: "a benchmarking range" },
  { cidr: "198.51.100.0/24", why: "a documentation range" },
  { cidr: "203.0.113.0/24", why: "a documentation range" },
  { cidr: "224.0.0.0/4", why: "multicast" },
  { cidr: "240.0.0.0/4", why: "a reserved range" },
];

const PARSED_V4 = BLOCKED_V4.map(({ cidr, why }) => {
  const [base, bitsRaw] = cidr.split("/") as [string, string];
  const bits = Number(bitsRaw);
  const baseInt = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (baseInt & mask) >>> 0, mask, why, cidr };
});

function expandIpv6(ip: string): string | null {
  const zone = ip.indexOf("%");
  const clean = (zone === -1 ? ip : ip.slice(0, zone)).toLowerCase();
  const halves = clean.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0]!.split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];
  const fillCount = 8 - head.length - tail.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (fillCount < 0) return null;

  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? fillCount : 0).fill("0"),
    ...tail,
  ];
  if (groups.length !== 8) return null;
  return groups.map((g) => (g === "" ? "0" : g).padStart(4, "0")).join(":");
}

function checkIpv6(ip: string): string | null {
  const expanded = expandIpv6(ip);
  if (!expanded) return "an address Aeyhey could not parse";

  // ::ffff:a.b.c.d and ::ffff:0:a.b.c.d map an IPv4 address into IPv6 space.
  const v4Mapped = /^0000:0000:0000:0000:(0000|ffff):ffff:([0-9a-f]{4}):([0-9a-f]{4})$/.exec(
    expanded,
  );
  if (v4Mapped) {
    const high = Number.parseInt(v4Mapped[2]!, 16);
    const low = Number.parseInt(v4Mapped[3]!, 16);
    const asV4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
    return checkIpv4(asV4);
  }

  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return "loopback";
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return "this host";

  const firstGroup = Number.parseInt(expanded.slice(0, 4), 16);
  // fc00::/7, unique local addresses.
  if ((firstGroup & 0xfe00) === 0xfc00) return "a private network";
  // fe80::/10, link-local.
  if ((firstGroup & 0xffc0) === 0xfe80) return "link-local";
  // ff00::/8, multicast.
  if ((firstGroup & 0xff00) === 0xff00) return "multicast";
  // 100::/64, discard-only.
  if (expanded.startsWith("0100:0000:0000:0000")) return "a discard-only range";
  return null;
}

function checkIpv4(ip: string): string | null {
  const value = ipv4ToInt(ip);
  if (value === null) return "an address Aeyhey could not parse";
  for (const range of PARSED_V4) {
    if ((value & range.mask) >>> 0 === range.network) return `${range.why} (${range.cidr})`;
  }
  return null;
}

/** Returns null when the address is fine to fetch, or a plain reason when it is not. */
export function blockedReasonForAddress(address: string): string | null {
  const family = isIP(address);
  if (family === 4) return checkIpv4(address);
  if (family === 6) return checkIpv6(address);
  return "an address Aeyhey could not parse";
}

export interface UrlGuardOptions {
  allowPrivate?: boolean;
  /** Swappable so tests do not need real DNS. */
  resolve?: (hostname: string) => Promise<string[]>;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

export interface GuardedUrl {
  url: URL;
  addresses: string[];
}

/**
 * Validates a URL and every address its host resolves to. Call this before the first
 * request and again for every redirect target.
 */
export async function assertFetchableUrl(
  raw: string | URL,
  options: UrlGuardOptions = {},
): Promise<GuardedUrl> {
  let url: URL;
  try {
    url = raw instanceof URL ? raw : new URL(raw);
  } catch {
    throw new BlockedUrlError(String(raw), "that is not a valid URL");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError(url.toString(), `only http and https work, not ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError(url.toString(), "a URL with credentials in it is not allowed");
  }

  if (options.allowPrivate) return { url, addresses: [] };

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  // A literal IP needs no DNS, and must be checked directly.
  if (isIP(hostname)) {
    const reason = blockedReasonForAddress(hostname);
    if (reason) throw new BlockedUrlError(url.toString(), `${hostname} is ${reason}`);
    return { url, addresses: [hostname] };
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new BlockedUrlError(url.toString(), "localhost is loopback");
  }

  let addresses: string[];
  try {
    addresses = await (options.resolve ?? defaultResolve)(hostname);
  } catch {
    throw new BlockedUrlError(url.toString(), `the host ${hostname} did not resolve`);
  }
  if (addresses.length === 0) {
    throw new BlockedUrlError(url.toString(), `the host ${hostname} did not resolve`);
  }

  // Every answer must pass. One private address in a DNS rebinding reply is enough to refuse.
  for (const address of addresses) {
    const reason = blockedReasonForAddress(address);
    if (reason) {
      throw new BlockedUrlError(
        url.toString(),
        `${hostname} resolves to ${address}, which is ${reason}`,
      );
    }
  }

  return { url, addresses };
}

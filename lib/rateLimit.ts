import { LIMITS } from "./limits";

/**
 * In-memory per-IP rate limiter. Lives inside a single Vercel function
 * instance — under heavy load Vercel will spin up parallel instances and
 * this won't catch cross-instance abuse. Good enough as the first line of
 * defense for a free hosted demo; the actual ceiling is the provider's
 * own free-tier quota.
 */

type RouteKind = "persona" | "synthesize" | "fromRepo";

interface Buckets {
  persona: number[];
  synthesize: number[];
  fromRepo: number[];
  lastTouchedMs: number;
}

const ipMap = new Map<string, Buckets>();
const MAX_TRACKED_IPS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getBuckets(ip: string): Buckets {
  let b = ipMap.get(ip);
  if (!b) {
    b = { persona: [], synthesize: [], fromRepo: [], lastTouchedMs: Date.now() };
    ipMap.set(ip, b);
    if (ipMap.size > MAX_TRACKED_IPS) {
      // Evict the IP with the oldest lastTouchedMs to keep memory bounded.
      let oldestKey: string | undefined;
      let oldestTs = Infinity;
      for (const [key, val] of ipMap) {
        if (val.lastTouchedMs < oldestTs) {
          oldestTs = val.lastTouchedMs;
          oldestKey = key;
        }
      }
      if (oldestKey !== undefined) ipMap.delete(oldestKey);
    }
  }
  return b;
}

function purge(arr: number[], cutoffMs: number): number[] {
  let i = 0;
  while (i < arr.length && arr[i] < cutoffMs) i++;
  return i === 0 ? arr : arr.slice(i);
}

export interface RateLimitResult {
  ok: boolean;
  reason?: string;
  retryAfterSeconds?: number;
}

export function checkRateLimit(ip: string, kind: RouteKind): RateLimitResult {
  const now = Date.now();
  const b = getBuckets(ip);
  b.lastTouchedMs = now;

  // Purge each bucket down to 24h.
  b.persona = purge(b.persona, now - DAY_MS);
  b.synthesize = purge(b.synthesize, now - DAY_MS);
  b.fromRepo = purge(b.fromRepo, now - DAY_MS);

  const arr = b[kind];
  const inLast = (windowMs: number) =>
    arr.reduce((acc, t) => (t >= now - windowMs ? acc + 1 : acc), 0);

  let limits: { perMinute?: number; perHour?: number; perDay?: number };
  if (kind === "persona") {
    limits = {
      perMinute: LIMITS.personaPerMinute,
      perHour: LIMITS.personaPerHour,
      perDay: LIMITS.personaPerDay,
    };
  } else if (kind === "synthesize") {
    limits = {
      perMinute: LIMITS.synthesizePerMinute,
      perHour: LIMITS.synthesizePerHour,
      perDay: LIMITS.synthesizePerDay,
    };
  } else {
    limits = {
      perHour: LIMITS.fromRepoPerHour,
      perDay: LIMITS.fromRepoPerDay,
    };
  }

  if (limits.perMinute !== undefined) {
    const n = inLast(60_000);
    if (n >= limits.perMinute) {
      return {
        ok: false,
        reason: `rate limit: ${limits.perMinute} ${kind} requests per minute`,
        retryAfterSeconds: 60,
      };
    }
  }
  if (limits.perHour !== undefined) {
    const n = inLast(60 * 60_000);
    if (n >= limits.perHour) {
      return {
        ok: false,
        reason: `rate limit: ${limits.perHour} ${kind} requests per hour`,
        retryAfterSeconds: 3600,
      };
    }
  }
  if (limits.perDay !== undefined) {
    const n = inLast(DAY_MS);
    if (n >= limits.perDay) {
      return {
        ok: false,
        reason: `rate limit: ${limits.perDay} ${kind} requests per day`,
        retryAfterSeconds: DAY_MS / 1000,
      };
    }
  }

  arr.push(now);
  return { ok: true };
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export function isPanelDisabled(): boolean {
  const v = process.env.PANEL_DISABLED;
  return v === "1" || v === "true";
}

export function disabledResponse(): Response {
  return new Response(
    "The Panel demo is paused. Fork the repo and run it with your own API key.",
    { status: 503, headers: { "Retry-After": "3600" } },
  );
}

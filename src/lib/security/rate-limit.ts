import "server-only";
import { sha256Hex } from "./tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limiting backed by Postgres (public.rate_limit_hit), so
 * limits hold across serverless instances without another service. Keys are
 * salted SHA-256 hashes — raw IPs and emails are never stored. If the
 * database limiter is unreachable, a per-instance in-memory window is used so
 * limits still apply (more loosely) rather than disappearing.
 */
export const RATE_LIMITS = {
  applicationCreate: { limit: 10, windowSeconds: 3600 },
  applicationSave: { limit: 300, windowSeconds: 600 },
  applicationUpload: { limit: 40, windowSeconds: 3600 },
  contact: { limit: 5, windowSeconds: 600 },
  waitlist: { limit: 5, windowSeconds: 600 },
  loginIp: { limit: 20, windowSeconds: 600 },
  loginEmail: { limit: 8, windowSeconds: 600 },
  magicLink: { limit: 5, windowSeconds: 900 },
  passwordReset: { limit: 5, windowSeconds: 900 },
  upload: { limit: 60, windowSeconds: 600 },
  download: { limit: 120, windowSeconds: 600 },
  export: { limit: 20, windowSeconds: 600 },
  invite: { limit: 20, windowSeconds: 3600 },
  checkout: { limit: 10, windowSeconds: 600 },
  mfa: { limit: 10, windowSeconds: 600 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  return {
    ok: entry.count <= limit,
    remaining: Math.max(limit - entry.count, 0),
    retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

export function rateLimitKey(name: RateLimitName, identifier: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? "development-rate-limit-salt";
  return `${name}:${sha256Hex(`${salt}:${name}:${identifier.toLowerCase()}`)}`;
}

export async function rateLimit(name: RateLimitName, identifier: string | null | undefined): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const key = rateLimitKey(name, identifier || "unknown");
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("rate_limit_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || !data?.[0]) throw error ?? new Error("empty rate limit response");
    const row = data[0];
    return {
      ok: row.allowed,
      remaining: row.remaining,
      retryAfterSeconds: Math.max(0, Math.ceil((Date.parse(row.reset_at) - Date.now()) / 1000)),
    };
  } catch (error) {
    console.error("[rate-limit] database limiter unavailable, using in-memory fallback", error instanceof Error ? error.message : error);
    return memoryHit(key, limit, windowSeconds);
  }
}

export class RateLimitError extends Error {
  override name = "RateLimitError";
  constructor(readonly retryAfterSeconds: number) {
    super("Too many attempts. Please wait a few minutes and try again.");
  }
}

export async function enforceRateLimit(name: RateLimitName, identifier: string | null | undefined): Promise<void> {
  const result = await rateLimit(name, identifier);
  if (!result.ok) throw new RateLimitError(result.retryAfterSeconds);
}

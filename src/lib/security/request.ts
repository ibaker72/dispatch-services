/**
 * Request metadata helpers. The client IP is used only for rate-limit keys
 * (hashed) and for agreement-acceptance evidence; it is never sent to
 * analytics.
 */
type HeaderSource = { get(name: string): string | null };

export function clientIp(headers: HeaderSource): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  const candidate = first || headers.get("x-real-ip")?.trim() || null;
  if (!candidate) return null;
  // Accept IPv4 / IPv6 literal forms only (stored in an inet column).
  return /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : null;
}

export function userAgent(headers: HeaderSource): string | null {
  const ua = headers.get("user-agent");
  return ua ? ua.slice(0, 512) : null;
}

/**
 * Rejects cross-site state-changing requests. Next.js already compares the
 * Origin of Server Action requests with the host, but lets requests without
 * an Origin header through; browsers always send Origin on POST, so we require
 * it for authenticated mutations and custom POST route handlers.
 */
export function isSameOriginRequest(headers: HeaderSource, allowedOrigins: string[] = []): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host && originHost === host) return true;
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).host === originHost;
    } catch {
      return false;
    }
  });
}

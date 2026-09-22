/**
 * Content Security Policy. Scripts require a per-request nonce
 * ('strict-dynamic'); no third-party script origins are allowed. Analytics and
 * error reporting are bundled npm packages that only need connect-src.
 */
export interface CspOptions {
  nonce: string;
  isDev: boolean;
  supabaseUrl?: string;
  posthogHost?: string;
  turnstile?: boolean;
}

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp(opts: CspOptions): string {
  const supabase = origin(opts.supabaseUrl);
  const posthog = origin(opts.posthogHost);
  const connect = ["'self'", supabase, posthog, "https://*.ingest.sentry.io", "https://*.ingest.us.sentry.io"].filter(Boolean);
  const scriptSrc = ["'self'", `'nonce-${opts.nonce}'`, "'strict-dynamic'"];
  const frameSrc = ["'self'"];
  if (opts.isDev) scriptSrc.push("'unsafe-eval'");
  if (opts.turnstile) {
    scriptSrc.push("https://challenges.cloudflare.com");
    frameSrc.push("https://challenges.cloudflare.com");
  }
  if (opts.isDev) connect.push("ws:");

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Inline style attributes are used by component libraries; styles cannot execute script.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect as string[],
    "frame-src": frameSrc,
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
  const policy = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
  return opts.isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

export const STATIC_SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

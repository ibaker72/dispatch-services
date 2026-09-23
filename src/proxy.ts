import { type NextRequest, NextResponse } from "next/server";
import { buildCsp } from "@/lib/security/csp";
import { refreshSession } from "@/lib/supabase/proxy";

/**
 * Runs before rendering: issues a per-request CSP nonce and refreshes the
 * Supabase session cookie. It deliberately makes no authorization decisions —
 * pages, server actions and database RLS enforce access independently.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    posthogHost: process.env.NEXT_PUBLIC_POSTHOG_KEY ? (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com") : undefined,
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return refreshSession(request, response);
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|monitoring|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml|api/stripe|api/payments|api/cron).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

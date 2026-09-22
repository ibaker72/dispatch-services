import { type NextRequest, NextResponse } from "next/server";
import { DRAFT_COOKIE, DRAFT_TTL_DAYS, findByToken } from "@/lib/applications/service";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Resume link from email: exchanges the token in the URL for the httpOnly
 * draft cookie, then redirects so the token no longer appears in the address
 * bar or browser history.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const limited = await rateLimit("applicationSave", `resume:${clientIp(request.headers) ?? "unknown"}`);
  const app = limited.ok ? await findByToken(createSupabaseAdminClient(), token) : null;
  const response = NextResponse.redirect(new URL(app ? "/apply" : "/apply?resume=invalid", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (app && token) {
    response.cookies.set(DRAFT_COOKIE, token, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/apply",
      maxAge: DRAFT_TTL_DAYS * 86_400,
    });
  }
  return response;
}

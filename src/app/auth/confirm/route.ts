import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { safeRedirectPath } from "@/lib/security/redirect";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED: Record<string, EmailOtpType> = {
  email: "email",
  magiclink: "email",
  signup: "email",
  recovery: "recovery",
  invite: "invite",
  email_change: "email_change",
};

/**
 * Email link landing (token-hash flow): verifies the one-time token with
 * Supabase Auth, establishes the session cookie and redirects to a validated
 * same-site path. Works even when the link is opened in a different browser.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = ALLOWED[params.get("type") ?? ""];
  const fallback = type === "recovery" ? "/reset-password" : type === "invite" ? "/invite/accept" : "/login?confirmed=1";
  const next = safeRedirectPath(params.get("next"), fallback, siteUrl());

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      if (type !== "recovery" && type !== "invite") {
        await supabase.rpc("log_security_event", { p_action: "auth.magic_link_login" });
      }
      const target = type === "recovery" ? "/reset-password" : next === "/login?confirmed=1" ? "/" : next;
      const response = NextResponse.redirect(new URL(target, request.url), 303);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
  }
  return NextResponse.redirect(new URL("/login?error=link_invalid", request.url), 303);
}

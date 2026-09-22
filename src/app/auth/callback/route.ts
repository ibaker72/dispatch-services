import { type NextRequest, NextResponse } from "next/server";
import { safeRedirectPath } from "@/lib/security/redirect";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** PKCE code exchange (links opened in the same browser that requested them). */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"), "/", siteUrl());
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url), 303);
  }
  return NextResponse.redirect(new URL("/login?error=link_invalid", request.url), 303);
}

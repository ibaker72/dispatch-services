import { type NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { RateLimitError, enforceRateLimit } from "@/lib/security/rate-limit";
import { storage } from "@/lib/storage";

/**
 * Document download: the row is read with the signed-in user's client, so
 * Row Level Security decides access (IDOR-safe). Only then is a short-lived
 * signed URL issued for the private bucket object.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const ctx = await getAuthContext();
  if (!ctx) return new NextResponse("Sign in required", { status: 401 });
  try {
    await enforceRateLimit("download", ctx.userId);
  } catch (error) {
    if (error instanceof RateLimitError) return new NextResponse(error.message, { status: 429 });
    throw error;
  }
  const { data: doc } = await ctx.supabase
    .from("documents")
    .select("id, storage_path, original_filename, status, carrier_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc || doc.status === "uploading") return new NextResponse("Not found", { status: 404 });
  const url = await storage().createSignedDownload(doc.storage_path, doc.original_filename);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

import { type NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { MAX_UPLOAD_BYTES, sniffMimeType } from "@/lib/security/files";
import { type LocalOperation, localStorageDriver, verifyLocalToken } from "@/lib/storage";

/**
 * Development/test stand-in for Supabase Storage signed URLs
 * (STORAGE_DRIVER=local only; the environment validator refuses this driver
 * in production). Every request must carry a valid, unexpired HMAC signature
 * bound to the operation and object path.
 */
function authorize(request: NextRequest, op: LocalOperation) {
  const env = serverEnv();
  const driver = env.STORAGE_DRIVER === "local" ? localStorageDriver() : null;
  if (!driver || !env.LOCAL_STORAGE_SIGNING_SECRET) return null;
  const params = request.nextUrl.searchParams;
  const path = params.get("path") ?? "";
  const ok =
    params.get("op") === op &&
    verifyLocalToken(env.LOCAL_STORAGE_SIGNING_SECRET, op, path, Number(params.get("exp")), params.get("sig") ?? "", params.get("name") ?? "");
  return ok ? { driver, path, name: params.get("name") ?? "document" } : null;
}

export async function PUT(request: NextRequest) {
  const auth = authorize(request, "upload");
  if (!auth) return NextResponse.json({ error: "invalid or expired upload URL" }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "invalid size" }, { status: 400 });
  try {
    await auth.driver.write(auth.path, bytes);
  } catch {
    return NextResponse.json({ error: "object already exists" }, { status: 409 });
  }
  return NextResponse.json({ Key: auth.path });
}

export async function GET(request: NextRequest) {
  const auth = authorize(request, "download");
  if (!auth) return NextResponse.json({ error: "invalid or expired download URL" }, { status: 403 });
  const bytes = await auth.driver.download(auth.path);
  if (!bytes) return NextResponse.json({ error: "not found" }, { status: 404 });
  const safeName = auth.name.replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": sniffMimeType(bytes) ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import "server-only";
import { randomUUID } from "node:crypto";
import type { Enums } from "@/lib/db/database.types";
import { AppError, NotFoundError } from "@/lib/errors";
import { type AllowedMimeType, validateUploadMetadata, verifyStoredFile } from "@/lib/security/files";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/security/tokens";
import { type SignedUpload, storage } from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserSupabaseClient } from "@/lib/supabase/server";

/**
 * Carrier/load document uploads for signed-in users. Every database call uses
 * the caller's own client, so Row Level Security decides which carrier (and
 * load, driver or truck — enforced by composite foreign keys) a document can
 * be attached to. Bytes go straight to private storage through a short-lived
 * signed URL; finalize verifies them before the document becomes visible.
 */
export interface UploadRequest {
  carrierId: string;
  docType: Enums<"document_type">;
  filename: string;
  mimeType: string;
  size: number;
  expiresOn?: string | null;
  loadId?: string | null;
  driverId?: string | null;
  truckId?: string | null;
  visibility?: "carrier" | "internal";
}

export async function requestDocumentUpload(
  supabase: UserSupabaseClient,
  userId: string,
  req: UploadRequest,
): Promise<{ documentId: string; upload: SignedUpload }> {
  await enforceRateLimit("upload", userId);
  const check = validateUploadMetadata({ filename: req.filename, mimeType: req.mimeType, size: req.size });
  if (!check.ok) throw new AppError(check.error);

  const documentId = randomUUID();
  const storagePath = `carriers/${req.carrierId}/${documentId}/${check.safeName}`;
  const { error } = await supabase.from("documents").insert({
    id: documentId,
    carrier_id: req.carrierId,
    load_id: req.loadId ?? null,
    driver_id: req.driverId ?? null,
    truck_id: req.truckId ?? null,
    doc_type: req.docType,
    storage_path: storagePath,
    original_filename: req.filename.slice(0, 255),
    mime_type: check.mimeType,
    size_bytes: req.size,
    expires_on: req.expiresOn ?? null,
    visibility: req.visibility ?? "carrier",
  });
  if (error) {
    if (error.code === "42501" || error.code === "23503") throw new AppError("You cannot upload documents here.", "forbidden");
    throw new AppError("We could not prepare the upload. Please try again.");
  }
  return { documentId, upload: await storage().createSignedUpload(storagePath, check.mimeType) };
}

export async function finalizeDocumentUpload(supabase: UserSupabaseClient, userId: string, documentId: string): Promise<void> {
  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, mime_type, status, uploaded_by")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.uploaded_by !== userId) throw new NotFoundError("Upload not found.");
  if (doc.status !== "uploading") return;

  const bytes = await storage().download(doc.storage_path);
  const verdict = bytes ? verifyStoredFile(bytes, doc.mime_type as AllowedMimeType) : { ok: false as const, error: "The upload did not complete." };
  if (!verdict.ok || !bytes) {
    await storage().remove(doc.storage_path).catch(() => undefined);
    // Ownership was checked above with the caller's RLS-scoped read. The withdrawal itself uses the
    // service role: carriers cannot read deleted rows, which PostgREST's RETURNING would require.
    await createSupabaseAdminClient().from("documents").update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq("id", doc.id).eq("status", "uploading");
    throw new AppError(verdict.ok ? "The upload did not complete." : verdict.error);
  }
  const { error } = await supabase
    .from("documents")
    .update({ status: "pending_review", sha256: sha256Hex(bytes), size_bytes: bytes.byteLength })
    .eq("id", doc.id);
  if (error) throw new AppError("We could not record the upload. Please try again.");
}

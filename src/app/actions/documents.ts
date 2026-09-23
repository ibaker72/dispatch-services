"use server";

import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/actions";
import { getAuthContext } from "@/lib/auth/session";
import { Constants } from "@/lib/db/database.types";
import { finalizeDocumentUpload, requestDocumentUpload } from "@/lib/documents/service";
import { AppError } from "@/lib/errors";
import type { SignedUpload } from "@/lib/storage";

const optionalUuid = z.preprocess((v) => (v === "" ? undefined : v), z.uuid().nullish());

const requestSchema = z.object({
  carrierId: z.uuid(),
  docType: z.enum(Constants.public.Enums.document_type),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().max(100),
  size: z.number().int().positive(),
  expiresOn: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date").nullish()),
  loadId: optionalUuid,
  driverId: optionalUuid,
  truckId: optionalUuid,
  internal: z.boolean().optional(),
});

async function signedIn() {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.emailVerified) throw new AppError("Please sign in again.", "unauthenticated");
  return ctx;
}

/** Step 1 of an upload: RLS-checked document row + signed storage URL. */
export async function requestDocumentUploadAction(input: z.input<typeof requestSchema>): Promise<ActionResult<{ documentId: string; upload: SignedUpload }>> {
  return runAction(requestSchema, input, async (data) => {
    const ctx = await signedIn();
    return requestDocumentUpload(ctx.supabase, ctx.userId, {
      ...data,
      // Only staff may keep a document internal; the database also forces carrier uploads to be visible.
      visibility: data.internal && ctx.staffRoles.length ? "internal" : "carrier",
    });
  });
}

/** Step 2: verify the stored bytes and mark the document ready for review. */
export async function finalizeDocumentUploadAction(input: { documentId: string }): Promise<ActionResult<null>> {
  return runAction(z.object({ documentId: z.uuid() }), input, async ({ documentId }) => {
    const ctx = await signedIn();
    await finalizeDocumentUpload(ctx.supabase, ctx.userId, documentId);
    return null;
  });
}

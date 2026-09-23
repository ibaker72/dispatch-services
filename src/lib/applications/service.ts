import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Enums, Json, Tables } from "@/lib/db/database.types";
import { AppError, NotFoundError } from "@/lib/errors";
import { type AllowedMimeType, validateUploadMetadata, verifyStoredFile } from "@/lib/security/files";
import { randomToken, sha256Hex } from "@/lib/security/tokens";
import type { ApplicationQuestion } from "@/lib/settings";
import { type SignedUpload, storage } from "@/lib/storage";
import type { AdminSupabaseClient } from "@/lib/supabase/admin";
import {
  APPLICATION_STEPS,
  SUBMISSION_CONSENT_VERSION,
  type StepKey,
  consentStrict,
  draftStepSchema,
  normalizeAuthorityNumber,
  stepByKey,
} from "@/lib/validation/application";

/**
 * Carrier application service. Applicants are anonymous, so this module uses
 * the service role, scoped to exactly one application identified by the
 * SHA-256 of a random draft token held in an httpOnly cookie.
 */
export const DRAFT_COOKIE = "carrier_application";
export const DRAFT_TTL_DAYS = 30;
export const APPLICATION_DOCUMENT_TYPES = ["w9", "certificate_of_insurance", "operating_authority", "notice_of_assignment", "other"] as const;
export type ApplicationDocumentType = (typeof APPLICATION_DOCUMENT_TYPES)[number];

export type ApplicationRecord = Pick<
  Tables<"carrier_applications">,
  | "id"
  | "status"
  | "current_step"
  | "completed_steps"
  | "form_data"
  | "email"
  | "contact_name"
  | "legal_name"
  | "primary_equipment_type"
  | "truck_count"
  | "submitted_at"
  | "information_request"
  | "resume_token_expires_at"
>;

const APPLICATION_COLUMNS =
  "id, status, current_step, completed_steps, form_data, email, contact_name, legal_name, primary_equipment_type, truck_count, submitted_at, information_request, resume_token_expires_at";

export type FormData = Partial<Record<StepKey, Record<string, unknown>>>;

export function isEditable(status: Enums<"application_status">): boolean {
  return status === "draft" || status === "information_requested";
}

export async function createDraft(admin: AdminSupabaseClient): Promise<{ id: string; token: string }> {
  const token = randomToken();
  const { data, error } = await admin
    .from("carrier_applications")
    .insert({
      resume_token_hash: sha256Hex(token),
      resume_token_expires_at: new Date(Date.now() + DRAFT_TTL_DAYS * 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new AppError("We could not start your application. Please try again.");
  return { id: data.id, token };
}

export async function findByToken(admin: AdminSupabaseClient, token: string | null | undefined): Promise<ApplicationRecord | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  const { data } = await admin
    .from("carrier_applications")
    .select(APPLICATION_COLUMNS)
    .eq("resume_token_hash", sha256Hex(token))
    .gt("resume_token_expires_at", new Date().toISOString())
    .maybeSingle();
  return data ?? null;
}

/** Copies key answers into indexed columns used by the review pipeline. */
export function derivedColumns(form: FormData) {
  const contact = (form.contact ?? {}) as Record<string, unknown>;
  const business = (form.business ?? {}) as Record<string, unknown>;
  const equipment = (form.equipment ?? {}) as Record<string, unknown>;
  const lanes = (form.lanes ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const truckCount = Number(equipment.truckCount);
  const equipmentType = str(equipment.primaryEquipmentType, 40);
  const homeState = str(lanes.homeBaseState, 2)?.toUpperCase() ?? null;
  const mc = str(business.mcNumber, 20);
  const dot = str(business.usdotNumber, 20);
  const email = str(contact.email, 254)?.toLowerCase() ?? null;
  return {
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    contact_name: str(contact.fullName, 200),
    phone: str(contact.phone, 40),
    legal_name: str(business.legalName, 200),
    dba_name: str(business.dbaName, 200),
    mc_number: mc ? normalizeAuthorityNumber(mc).slice(0, 20) || null : null,
    usdot_number: dot ? normalizeAuthorityNumber(dot).slice(0, 20) || null : null,
    primary_equipment_type: equipmentType && ["car_hauler", "hotshot", "box_truck", "dry_van"].includes(equipmentType) ? equipmentType : null,
    truck_count: Number.isInteger(truckCount) && truckCount >= 0 && truckCount <= 500 ? truckCount : null,
    home_base_state: homeState && /^[A-Z]{2}$/.test(homeState) ? homeState : null,
  };
}

export class StepValidationError extends Error {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super("Please check the highlighted fields.");
    this.name = "StepValidationError";
  }
}

/**
 * Saves one step. `complete=false` is autosave (lenient); `complete=true`
 * validates the step strictly and marks it complete.
 */
export async function saveStep(
  admin: AdminSupabaseClient,
  app: ApplicationRecord,
  stepKey: StepKey,
  data: unknown,
  complete: boolean,
): Promise<ApplicationRecord> {
  if (!isEditable(app.status)) throw new AppError("This application has already been submitted.");
  const step = stepByKey(stepKey);
  let value: Record<string, unknown>;
  if (complete) {
    const parsed = step.schema.safeParse(data);
    if (!parsed.success) throw new StepValidationError(parsed.error.issues);
    value = parsed.data as Record<string, unknown>;
  } else {
    const parsed = draftStepSchema.safeParse(data);
    if (!parsed.success) throw new StepValidationError(parsed.error.issues);
    value = parsed.data;
  }

  const form = { ...((app.form_data ?? {}) as FormData), [stepKey]: value };
  const completed = new Set(app.completed_steps ?? []);
  if (complete) completed.add(step.number);
  const nextStep = complete ? Math.min(step.number + 1, APPLICATION_STEPS.length) : step.number;

  const { data: updated, error } = await admin
    .from("carrier_applications")
    .update({
      form_data: form as Json,
      completed_steps: [...completed].sort((a, b) => a - b),
      current_step: Math.max(app.current_step, nextStep),
      last_activity_at: new Date().toISOString(),
      ...derivedColumns(form),
    })
    .eq("id", app.id)
    .select(APPLICATION_COLUMNS)
    .single();
  if (error || !updated) throw new AppError("We could not save your progress. Please try again.");
  return updated;
}

export async function listDocuments(admin: AdminSupabaseClient, applicationId: string) {
  const { data } = await admin
    .from("documents")
    .select("id, doc_type, original_filename, size_bytes, status, uploaded_at")
    .eq("application_id", applicationId)
    .is("deleted_at", null)
    .neq("status", "uploading")
    .order("uploaded_at");
  return data ?? [];
}

export async function requestUpload(
  admin: AdminSupabaseClient,
  app: ApplicationRecord,
  meta: { docType: string; filename: string; mimeType: string; size: number },
): Promise<{ documentId: string; upload: SignedUpload }> {
  if (!isEditable(app.status)) throw new AppError("This application has already been submitted.");
  if (!(APPLICATION_DOCUMENT_TYPES as readonly string[]).includes(meta.docType)) throw new AppError("Unsupported document type.");
  const check = validateUploadMetadata(meta);
  if (!check.ok) throw new AppError(check.error);

  const { count } = await admin.from("documents").select("id", { count: "exact", head: true }).eq("application_id", app.id).is("deleted_at", null);
  if ((count ?? 0) >= 25) throw new AppError("You have uploaded the maximum number of documents for an application.");

  const documentId = randomUUID();
  const storagePath = `applications/${app.id}/${documentId}/${check.safeName}`;
  const { error } = await admin.from("documents").insert({
    id: documentId,
    application_id: app.id,
    doc_type: meta.docType as ApplicationDocumentType,
    status: "uploading",
    storage_path: storagePath,
    original_filename: meta.filename.slice(0, 255),
    mime_type: check.mimeType,
    size_bytes: meta.size,
  });
  if (error) throw new AppError("We could not prepare the upload. Please try again.");
  return { documentId, upload: await storage().createSignedUpload(storagePath, check.mimeType) };
}

/**
 * Verifies the stored bytes (type sniffing, size) and records a SHA-256 hash.
 * Files that fail are removed from storage and the document row is deleted.
 */
export async function finalizeUpload(admin: AdminSupabaseClient, app: ApplicationRecord, documentId: string) {
  const { data: doc } = await admin
    .from("documents")
    .select("id, storage_path, mime_type, status")
    .eq("id", documentId)
    .eq("application_id", app.id)
    .maybeSingle();
  if (!doc) throw new NotFoundError("Upload not found.");
  if (doc.status !== "uploading") return;

  const bytes = await storage().download(doc.storage_path);
  const verdict = bytes ? verifyStoredFile(bytes, doc.mime_type as AllowedMimeType) : { ok: false as const, error: "The upload did not complete." };
  if (!verdict.ok || !bytes) {
    await storage().remove(doc.storage_path).catch(() => undefined);
    await admin.from("documents").delete().eq("id", doc.id);
    throw new AppError(verdict.ok ? "The upload did not complete." : verdict.error);
  }
  const { error } = await admin
    .from("documents")
    .update({ status: "pending_review", sha256: sha256Hex(bytes), size_bytes: bytes.byteLength })
    .eq("id", doc.id);
  if (error) throw new AppError("We could not record the upload. Please try again.");
}

export async function removeDocument(admin: AdminSupabaseClient, app: ApplicationRecord, documentId: string) {
  if (!isEditable(app.status)) throw new AppError("This application has already been submitted.");
  const { data: doc } = await admin
    .from("documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .eq("application_id", app.id)
    .maybeSingle();
  if (!doc) throw new NotFoundError("Document not found.");
  await admin.from("documents").update({ deleted_at: new Date().toISOString() }).eq("id", doc.id);
  await storage().remove(doc.storage_path).catch(() => undefined);
}

export interface SubmissionCheck {
  ok: boolean;
  incompleteSteps: Array<{ key: StepKey; title: string; message: string }>;
  missingDocuments: string[];
}

export async function checkSubmission(
  admin: AdminSupabaseClient,
  app: ApplicationRecord,
  questions: ApplicationQuestion[],
  consent: unknown,
): Promise<SubmissionCheck> {
  const form = (app.form_data ?? {}) as FormData;
  const incompleteSteps: SubmissionCheck["incompleteSteps"] = [];
  for (const step of APPLICATION_STEPS) {
    if (step.key === "consent") continue;
    const result = step.schema.safeParse(form[step.key] ?? {});
    if (!result.success) incompleteSteps.push({ key: step.key, title: step.title, message: result.error.issues[0]?.message ?? "Incomplete" });
  }
  const consentResult = consentStrict.safeParse(consent);
  if (!consentResult.success) {
    incompleteSteps.push({ key: "consent", title: "Review and submit", message: consentResult.error.issues[0]?.message ?? "Consent required" });
  } else {
    for (const q of questions.filter((q) => q.required)) {
      if (!consentResult.data.custom[q.id]?.trim()) incompleteSteps.push({ key: "consent", title: "Review and submit", message: `Please answer: ${q.label}` });
    }
  }

  const [{ data: requirements }, documents] = await Promise.all([
    admin.from("document_requirements").select("doc_type, label").eq("active", true).eq("applies_to", "carrier").eq("required_for_application", true),
    listDocuments(admin, app.id),
  ]);
  const uploaded = new Set(documents.map((d) => d.doc_type));
  const missingDocuments = (requirements ?? []).filter((r) => !uploaded.has(r.doc_type)).map((r) => r.label);
  return { ok: incompleteSteps.length === 0 && missingDocuments.length === 0, incompleteSteps, missingDocuments };
}

export async function submit(
  admin: AdminSupabaseClient,
  app: ApplicationRecord,
  consent: z.output<typeof consentStrict>,
  meta: { ip: string | null; userAgent: string | null },
): Promise<ApplicationRecord> {
  if (!isEditable(app.status)) throw new AppError("This application has already been submitted.");
  const form = { ...((app.form_data ?? {}) as FormData), consent: consent as unknown as Record<string, unknown> };
  const completed = new Set([...(app.completed_steps ?? []), 9]);
  const { data, error } = await admin
    .from("carrier_applications")
    .update({
      form_data: form as Json,
      completed_steps: [...completed].sort((a, b) => a - b),
      consent_version: SUBMISSION_CONSENT_VERSION,
      consent_accepted_at: new Date().toISOString(),
      consent_ip: meta.ip,
      consent_user_agent: meta.userAgent,
      submitted_at: new Date().toISOString(),
      status: "submitted",
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", app.id)
    .select(APPLICATION_COLUMNS)
    .single();
  if (error || !data) throw new AppError("We could not submit your application. Please try again.");
  return data;
}

/**
 * Issues a fresh resume token (used when staff request more information).
 * Rotating invalidates any earlier link, so only the newest email works.
 */
export async function rotateResumeToken(admin: AdminSupabaseClient, applicationId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + DRAFT_TTL_DAYS * 86_400_000).toISOString();
  const { error } = await admin
    .from("carrier_applications")
    .update({ resume_token_hash: sha256Hex(token), resume_token_expires_at: expiresAt })
    .eq("id", applicationId);
  if (error) throw new AppError("We could not create a new application link.");
  return { token, expiresAt };
}

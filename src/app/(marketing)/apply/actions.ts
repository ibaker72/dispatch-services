"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { type ActionResult, type FieldErrors, runAction, toActionError } from "@/lib/actions";
import { fleetSizeBucket } from "@/lib/analytics/events";
import { trackServer } from "@/lib/analytics/server";
import {
  APPLICATION_DOCUMENT_TYPES,
  type ApplicationRecord,
  DRAFT_COOKIE,
  DRAFT_TTL_DAYS,
  StepValidationError,
  checkSubmission,
  createDraft,
  finalizeUpload,
  findByToken,
  removeDocument,
  requestUpload,
  saveStep,
  submit,
} from "@/lib/applications/service";
import { EQUIPMENT_LABELS, type EquipmentKey } from "@/config/business";
import { formatDate } from "@/lib/domain/dates";
import { sendEmailSafely } from "@/lib/email/send";
import { adminNotificationEmails, serverEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp, userAgent } from "@/lib/security/request";
import { getApplicationQuestions } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { APPLICATION_STEPS, STEP_KEYS, consentStrict } from "@/lib/validation/application";

async function setDraftCookie(token: string) {
  (await cookies()).set(DRAFT_COOKIE, token, {
    httpOnly: true,
    secure: serverEnv().isProduction || absoluteUrl("/").startsWith("https:"),
    sameSite: "lax",
    path: "/apply",
    maxAge: DRAFT_TTL_DAYS * 86_400,
  });
}

async function currentApplication(): Promise<{ token: string; app: ApplicationRecord }> {
  const token = (await cookies()).get(DRAFT_COOKIE)?.value;
  const app = await findByToken(createSupabaseAdminClient(), token);
  if (!token || !app) throw new AppError("Your application session has expired. Start again or use your resume link.");
  return { token, app };
}

function stepErrors(error: StepValidationError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) (out[issue.path.join(".") || "_form"] ??= []).push(issue.message);
  return out;
}

export interface ProgressState {
  status: ApplicationRecord["status"];
  currentStep: number;
  completedSteps: number[];
}

const progress = (app: ApplicationRecord): ProgressState => ({
  status: app.status,
  currentStep: app.current_step,
  completedSteps: app.completed_steps ?? [],
});

export async function startApplication(): Promise<ActionResult<null>> {
  return runAction(z.object({}), {}, async () => {
    const existing = await findByToken(createSupabaseAdminClient(), (await cookies()).get(DRAFT_COOKIE)?.value);
    if (existing) return null;
    await enforceRateLimit("applicationCreate", clientIp(await headers()));
    const { id, token } = await createDraft(createSupabaseAdminClient());
    await setDraftCookie(token);
    await trackServer("application_started", id, { source: "apply_page" });
    return null;
  });
}

const saveSchema = z.object({
  step: z.enum(STEP_KEYS as [string, ...string[]]),
  data: z.record(z.string(), z.unknown()),
  complete: z.boolean(),
});

export async function saveApplicationStep(input: z.input<typeof saveSchema>): Promise<ActionResult<ProgressState>> {
  try {
    const parsed = saveSchema.parse(input);
    const { app } = await currentApplication();
    await enforceRateLimit("applicationSave", app.id);
    const updated = await saveStep(createSupabaseAdminClient(), app, parsed.step as (typeof STEP_KEYS)[number], parsed.data, parsed.complete);
    if (parsed.complete) {
      const step = APPLICATION_STEPS.find((s) => s.key === parsed.step)!;
      await trackServer("application_step_completed", app.id, { step: step.number, step_key: step.key });
    }
    return { ok: true, data: progress(updated) };
  } catch (error) {
    if (error instanceof StepValidationError) return { ok: false, error: error.message, fieldErrors: stepErrors(error) };
    return toActionError(error);
  }
}

const uploadSchema = z.object({
  docType: z.enum(APPLICATION_DOCUMENT_TYPES),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(100),
  size: z.number().int().positive(),
});

export async function requestApplicationUpload(input: z.input<typeof uploadSchema>) {
  return runAction(uploadSchema, input, async (data) => {
    const { app } = await currentApplication();
    await enforceRateLimit("applicationUpload", app.id);
    return requestUpload(createSupabaseAdminClient(), app, data);
  });
}

export async function finalizeApplicationUpload(input: { documentId: string }) {
  return runAction(z.object({ documentId: z.uuid() }), input, async ({ documentId }) => {
    const { app } = await currentApplication();
    await finalizeUpload(createSupabaseAdminClient(), app, documentId);
    return null;
  });
}

export async function removeApplicationDocument(input: { documentId: string }) {
  return runAction(z.object({ documentId: z.uuid() }), input, async ({ documentId }) => {
    const { app } = await currentApplication();
    await removeDocument(createSupabaseAdminClient(), app, documentId);
    return null;
  });
}

export async function emailResumeLink(): Promise<ActionResult<null>> {
  return runAction(z.object({}), {}, async () => {
    const { token, app } = await currentApplication();
    if (!app.email) throw new AppError("Add your email address in step 1 first.");
    await enforceRateLimit("magicLink", `resume:${app.id}`);
    await sendEmailSafely({
      to: app.email,
      template: "application_resume_link",
      applicationId: app.id,
      data: {
        contactName: app.contact_name ?? "there",
        resumeUrl: absoluteUrl(`/apply/resume?token=${encodeURIComponent(token)}`),
        expiresOn: formatDate(app.resume_token_expires_at),
      },
    });
    return null;
  });
}

export interface SubmitResult {
  submitted: boolean;
  incompleteSteps?: Array<{ key: string; title: string; message: string }>;
  missingDocuments?: string[];
}

export async function submitApplication(input: { consent: unknown }): Promise<ActionResult<SubmitResult>> {
  return runAction(z.object({ consent: z.unknown() }), input, async ({ consent }) => {
    const { token, app } = await currentApplication();
    const admin = createSupabaseAdminClient();
    const questions = await getApplicationQuestions();
    const check = await checkSubmission(admin, app, questions, consent);
    if (!check.ok) return { submitted: false, incompleteSteps: check.incompleteSteps, missingDocuments: check.missingDocuments };

    const h = await headers();
    const submitted = await submit(admin, app, consentStrict.parse(consent), { ip: clientIp(h), userAgent: userAgent(h) });

    if (submitted.email) {
      await sendEmailSafely({
        to: submitted.email,
        template: "application_received",
        applicationId: submitted.id,
        dedupeKey: `application_received:${submitted.id}:${submitted.submitted_at}`,
        data: {
          contactName: submitted.contact_name ?? "there",
          resumeUrl: absoluteUrl(`/apply/resume?token=${encodeURIComponent(token)}`),
        },
      });
    }
    const equipment = submitted.primary_equipment_type as EquipmentKey | null;
    for (const to of adminNotificationEmails()) {
      await sendEmailSafely({
        to,
        template: "admin_new_application",
        applicationId: submitted.id,
        data: {
          legalName: submitted.legal_name ?? "Unnamed carrier",
          equipment: equipment ? EQUIPMENT_LABELS[equipment] : "Not specified",
          truckCount: String(submitted.truck_count ?? "—"),
          reviewUrl: absoluteUrl(`/dashboard/applications/${submitted.id}`),
        },
      });
    }
    await trackServer("application_submitted", submitted.id, {
      equipment_type: submitted.primary_equipment_type ?? "unknown",
      fleet_size: fleetSizeBucket(submitted.truck_count),
    });
    return { submitted: true };
  });
}

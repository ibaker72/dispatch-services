"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { rotateResumeToken } from "@/lib/applications/service";
import { requireStaff } from "@/lib/auth/session";
import { APPLICATION_STATUS_LABELS } from "@/lib/domain/labels";
import { sendEmailSafely } from "@/lib/email/send";
import { AppError, NotFoundError } from "@/lib/errors";
import { sendCarrierInvitation } from "@/lib/invitations";
import { absoluteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formBool, formOptionalText, formOptionalUuid, requiredText } from "@/lib/validation/common";

const idSchema = z.object({ id: z.uuid() });

async function loadApplication(id: string) {
  const ctx = await requireStaff({ admin: true });
  const { data } = await ctx.supabase
    .from("carrier_applications")
    .select("id, status, email, contact_name, legal_name, carrier_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new NotFoundError("Application not found.");
  return { ctx, app: data };
}

export async function markUnderReview(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(idSchema, fd, async ({ id }) => {
    const { ctx, app } = await loadApplication(id);
    const { error } = await ctx.supabase
      .from("carrier_applications")
      .update({ status: "under_review", assigned_reviewer: ctx.userId })
      .eq("id", app.id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function requestInformation(fd: FormData): Promise<ActionResult<null>> {
  const schema = idSchema.extend({ request: requiredText("The request", 4000).min(10, "Describe what the carrier needs to provide") });
  return runFormAction(schema, fd, async ({ id, request }) => {
    const { ctx, app } = await loadApplication(id);
    const { error } = await ctx.supabase
      .from("carrier_applications")
      .update({ status: "information_requested", information_request: request })
      .eq("id", app.id);
    if (error) throw new DbError(error);
    if (app.email) {
      // A fresh resume link lets the applicant reopen the form from any device.
      const { token } = await rotateResumeToken(createSupabaseAdminClient(), app.id);
      await sendEmailSafely({
        to: app.email,
        template: "information_requested",
        data: { contactName: app.contact_name ?? "there", request, resumeUrl: absoluteUrl(`/apply/resume?token=${token}`) },
        applicationId: app.id,
        visibility: "carrier",
      });
    }
    return null;
  });
}

export async function approveApplication(fd: FormData): Promise<ActionResult<string>> {
  const schema = idSchema.extend({
    fee_plan_key: z.string().trim().min(1, "Choose a fee plan").max(60),
    dispatcher_id: formOptionalUuid,
    note: formOptionalText(2000),
    send_invitation: formBool,
  });
  const result = await runFormAction(schema, fd, async ({ id, fee_plan_key, dispatcher_id, note, send_invitation }) => {
    const { ctx, app } = await loadApplication(id);
    const { data: carrierId, error } = await ctx.supabase.rpc("approve_application", {
      p_application_id: app.id,
      p_fee_plan_key: fee_plan_key,
      p_dispatcher_id: dispatcher_id,
      p_note: note,
    });
    if (error || !carrierId) throw new DbError(error ?? { message: "approval failed" });

    if (app.email) {
      await sendEmailSafely({
        to: app.email,
        template: "application_approved",
        data: {
          contactName: app.contact_name ?? "there",
          carrierName: app.legal_name ?? "your company",
          nextSteps: "Next, you will set up your portal account, review and accept the dispatch service agreement, and confirm your documents. We start dispatching only after onboarding is complete.",
        },
        applicationId: app.id,
        carrierId,
        visibility: "carrier",
      });
      if (send_invitation) {
        await sendCarrierInvitation(ctx.supabase, { carrierId, email: app.email, role: "carrier_owner", invitedBy: ctx.userId, inviterName: ctx.profile?.full_name });
      }
    }
    return carrierId;
  });
  if (result.ok) redirect(`/dashboard/carriers/${result.data}`);
  return result;
}

export async function declineApplication(fd: FormData): Promise<ActionResult<null>> {
  const schema = idSchema.extend({ reason: requiredText("A reason", 2000).min(5, "Give a short reason"), notify: formBool });
  return runFormAction(schema, fd, async ({ id, reason, notify }) => {
    const { ctx, app } = await loadApplication(id);
    const { error } = await ctx.supabase.from("carrier_applications").update({ status: "declined", decision_reason: reason }).eq("id", app.id);
    if (error) throw new DbError(error);
    if (notify && app.email) {
      await sendEmailSafely({
        to: app.email,
        template: "application_status_changed",
        data: {
          contactName: app.contact_name ?? "there",
          statusLabel: APPLICATION_STATUS_LABELS.declined,
          note: "We are not able to offer dispatch service at this time. Thank you for considering us. You are welcome to contact us if your situation changes.",
        },
        applicationId: app.id,
        visibility: "carrier",
      });
    }
    return null;
  });
}

export async function reopenApplication(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(idSchema, fd, async ({ id }) => {
    const { ctx, app } = await loadApplication(id);
    if (app.status !== "declined") throw new AppError("Only declined applications can be reopened.");
    const { error } = await ctx.supabase.from("carrier_applications").update({ status: "under_review", assigned_reviewer: ctx.userId }).eq("id", app.id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function saveInternalNotes(fd: FormData): Promise<ActionResult<null>> {
  const schema = idSchema.extend({ internal_notes: formOptionalText(8000) });
  return runFormAction(schema, fd, async ({ id, internal_notes }) => {
    const { ctx, app } = await loadApplication(id);
    const { error } = await ctx.supabase.from("carrier_applications").update({ internal_notes: internal_notes ?? null }).eq("id", app.id);
    if (error) throw new DbError(error);
    return null;
  });
}

"use server";

import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { requireStaff } from "@/lib/auth/session";

import { AppError } from "@/lib/errors";
import { trackServer } from "@/lib/analytics/server";
import { sendCarrierInvitation } from "@/lib/invitations";
import {
  emailSchema,
  formBool,
  formDate,
  formMoney,
  formOptionalDate,
  formOptionalNumber,
  formOptionalText,
  optionalText,
  requiredText,
} from "@/lib/validation/common";

const carrierId = z.object({ carrier_id: z.uuid() });

export async function setCarrierStatus(fd: FormData): Promise<ActionResult<null>> {
  const schema = carrierId.extend({ status: z.enum(["active", "inactive", "onboarding"]) });
  return runFormAction(schema, fd, async ({ carrier_id, status }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase.from("carriers").update({ status }).eq("id", carrier_id);
    if (error) throw new DbError(error);
    if (status === "active") await trackServer("carrier_onboarding_completed", carrier_id, {});
    return null;
  });
}

export async function setAuthorityVerification(fd: FormData): Promise<ActionResult<null>> {
  const schema = carrierId.extend({
    authority_verification_status: z.enum(["unverified", "verified", "failed"]),
    authority_verification_notes: requiredText("Verification notes", 2000).min(5, "Record what you checked and where"),
    authority_active_date: formOptionalDate,
  });
  return runFormAction(schema, fd, async ({ carrier_id, authority_verification_status, authority_verification_notes, authority_active_date }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase
      .from("carriers")
      .update({ authority_verification_status, authority_verification_notes, ...(authority_active_date ? { authority_active_date } : {}) })
      .eq("id", carrier_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function updateCarrierDetails(fd: FormData): Promise<ActionResult<null>> {
  const schema = carrierId.extend({
    dba_name: formOptionalText(200),
    email: z.preprocess((v) => (v === "" ? undefined : v), emailSchema.optional()),
    phone: formOptionalText(40),
    address_line1: formOptionalText(200),
    address_line2: formOptionalText(200),
    city: formOptionalText(100),
    state: formOptionalText(2),
    postal_code: formOptionalText(10),
    home_base_city: formOptionalText(100),
    home_base_state: formOptionalText(2),
    insurance_expiration_date: formOptionalDate,
    noa_on_file: formBool,
    factoring_status: z.enum(["unknown", "none", "factoring", "quick_pay"]),
    factoring_company_name: formOptionalText(200),
    min_rate_per_mile: formOptionalNumber(0, 50, "Minimum rate"),
    max_deadhead_miles: formOptionalNumber(0, 2000, "Maximum deadhead"),
    preferences_notes: formOptionalText(2000),
  });
  return runFormAction(schema, fd, async ({ carrier_id, ...values }) => {
    const ctx = await requireStaff();
    const { error } = await ctx.supabase
      .from("carriers")
      .update({
        dba_name: values.dba_name ?? null,
        email: values.email ?? null,
        phone: values.phone ?? null,
        address_line1: values.address_line1 ?? null,
        address_line2: values.address_line2 ?? null,
        city: values.city ?? null,
        state: values.state?.toUpperCase() ?? null,
        postal_code: values.postal_code ?? null,
        home_base_city: values.home_base_city ?? null,
        home_base_state: values.home_base_state?.toUpperCase() ?? null,
        insurance_expiration_date: values.insurance_expiration_date ?? null,
        noa_on_file: values.noa_on_file,
        factoring_status: values.factoring_status,
        factoring_company_name: values.factoring_company_name ?? null,
        min_rate_per_mile: values.min_rate_per_mile ?? null,
        max_deadhead_miles: values.max_deadhead_miles ?? null,
        preferences_notes: values.preferences_notes ?? null,
      })
      .eq("id", carrier_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function changeFeeContract(fd: FormData): Promise<ActionResult<null>> {
  const schema = carrierId
    .extend({
      fee_plan_id: z.uuid("Choose a fee plan"),
      custom_terms: formBool,
      model: z.enum(["percentage", "flat_weekly"]).optional(),
      percentage_display: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().gt(0).lt(100).optional()),
      flat_weekly_amount: z.preprocess((v) => (v === "" ? undefined : v), formMoney("Weekly amount", 1).optional()),
      include_detention: formBool,
      include_layover: formBool,
      include_tonu: formBool,
      include_other: formBool,
      effective_from: formDate,
      notes: requiredText("A note", 2000).min(5, "Note why the terms changed (for example, the signed amendment)"),
    })
    .superRefine((v, ctx) => {
      if (!v.custom_terms) return;
      if (v.model === "percentage" && v.percentage_display === undefined) ctx.addIssue({ code: "custom", path: ["percentage_display"], message: "Enter the percentage" });
      if (v.model === "flat_weekly" && v.flat_weekly_amount === undefined) ctx.addIssue({ code: "custom", path: ["flat_weekly_amount"], message: "Enter the weekly amount" });
    });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await requireStaff({ admin: true });
    const custom = v.custom_terms && v.model ? v.model : null;
    const { error } = await ctx.supabase.rpc("replace_fee_contract", {
      p_carrier_id: v.carrier_id,
      p_fee_plan_id: v.fee_plan_id,
      p_effective_from: v.effective_from,
      p_notes: v.notes,
      ...(custom
        ? {
            p_model: custom,
            p_percentage: custom === "percentage" ? Number((v.percentage_display! / 100).toFixed(4)) : undefined,
            p_flat_weekly_amount: custom === "flat_weekly" ? Number(v.flat_weekly_amount) : undefined,
            p_include_detention: v.include_detention,
            p_include_layover: v.include_layover,
            p_include_tonu: v.include_tonu,
            p_include_other: v.include_other,
          }
        : {}),
    });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function assignDispatcher(fd: FormData): Promise<ActionResult<null>> {
  const schema = carrierId.extend({ dispatcher_id: z.uuid("Choose a dispatcher"), is_primary: formBool, note: formOptionalText(1000) });
  return runFormAction(schema, fd, async ({ carrier_id, dispatcher_id, is_primary, note }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase.rpc("assign_dispatcher", { p_carrier_id: carrier_id, p_dispatcher_id: dispatcher_id, p_primary: is_primary, p_note: note });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function endAssignment(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ assignment_id: z.uuid() }), fd, async ({ assignment_id }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase
      .from("dispatcher_assignments")
      .update({ ended_at: new Date().toISOString(), ended_by: ctx.userId })
      .eq("id", assignment_id)
      .is("ended_at", null);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function inviteCarrierUser(fd: FormData): Promise<ActionResult<null>> {
  const schema = carrierId.extend({ email: emailSchema, role: z.enum(["carrier_owner", "carrier_member"]) });
  return runFormAction(schema, fd, async ({ carrier_id, email, role }) => {
    const ctx = await requireStaff({ admin: true });
    await sendCarrierInvitation(ctx.supabase, { carrierId: carrier_id, email, role, invitedBy: ctx.userId, inviterName: ctx.profile?.full_name });
    return null;
  });
}

export async function revokeInvitation(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ invitation_id: z.uuid() }), fd, async ({ invitation_id }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase
      .from("organization_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", invitation_id)
      .is("accepted_at", null);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function removeMember(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ member_id: z.uuid() }), fd, async ({ member_id }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase
      .from("organization_members")
      .update({ status: "removed", removed_at: new Date().toISOString(), removed_by: ctx.userId })
      .eq("id", member_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function logCommunication(fd: FormData): Promise<ActionResult<null>> {
  const schema = carrierId.extend({
    channel: z.enum(["phone", "sms", "email", "note"]),
    direction: z.enum(["inbound", "outbound", "internal"]),
    subject: optionalText(300),
    body_text: requiredText("Details", 5000),
    load_id: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await requireStaff();
    const { error } = await ctx.supabase.from("communications").insert({
      carrier_id: v.carrier_id,
      load_id: v.load_id ?? null,
      channel: v.channel,
      direction: v.channel === "note" ? "internal" : v.direction,
      subject: v.subject ?? null,
      body_text: v.body_text,
      visibility: "internal",
      created_by: ctx.userId,
    });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function reviewDocument(fd: FormData): Promise<ActionResult<null>> {
  const schema = z
    .object({
      document_id: z.uuid(),
      decision: z.enum(["accepted", "rejected"]),
      expires_on: formOptionalDate,
      review_note: formOptionalText(2000),
    })
    .superRefine((v, ctx) => {
      if (v.decision === "rejected" && !v.review_note) ctx.addIssue({ code: "custom", path: ["review_note"], message: "Tell the carrier why the document was rejected" });
    });
  return runFormAction(schema, fd, async ({ document_id, decision, expires_on, review_note }) => {
    const ctx = await requireStaff();
    const { data: doc } = await ctx.supabase.from("documents").select("id, doc_type, status, expires_on").eq("id", document_id).maybeSingle();
    if (!doc) throw new AppError("Document not found.", "not_found");
    if (decision === "accepted" && doc.doc_type === "certificate_of_insurance" && !(expires_on ?? doc.expires_on)) {
      throw new AppError("Enter the policy expiration date before accepting a certificate of insurance.");
    }
    const { error } = await ctx.supabase
      .from("documents")
      .update({ status: decision, review_note: review_note ?? null, ...(expires_on ? { expires_on } : {}) })
      .eq("id", document_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function archiveDocument(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ document_id: z.uuid() }), fd, async ({ document_id }) => {
    const ctx = await requireStaff({ admin: true });
    const { error } = await ctx.supabase.from("documents").update({ deleted_at: new Date().toISOString() }).eq("id", document_id);
    if (error) throw new DbError(error);
    return null;
  });
}


"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { trackServer } from "@/lib/analytics/server";
import { requireCarrierUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/domain/dates";
import { toCents } from "@/lib/domain/money";
import { adminNotificationEmails } from "@/lib/env";
import { sendEmailSafely } from "@/lib/email/send";
import { AppError } from "@/lib/errors";
import { sendCarrierInvitation } from "@/lib/invitations";
import { payments } from "@/lib/payments";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp, userAgent } from "@/lib/security/request";
import { getFeatureFlag, getOperationsSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emailSchema, formBool, formOptionalNumber, formOptionalText, formOptionalUuid, requiredText } from "@/lib/validation/common";
import { DAYS } from "@/lib/validation/application";
import { SUPPORT_CATEGORIES } from "@/lib/domain/labels";

/**
 * Carrier portal actions. Authorization is enforced by RLS on every write
 * made with the user's client; the few service-role writes (agreement
 * acceptance evidence) validate ownership in the database trigger too.
 */

// ---- Agreements --------------------------------------------------------------
export async function acceptAgreement(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    version_id: z.uuid(),
    signer_name: requiredText("Your full name", 200).min(3, "Type your full legal name"),
    signer_title: requiredText("Your title", 120),
    agree: z.literal("on", { message: "Confirm that you have read and agree to this agreement" }),
  });
  return runFormAction(schema, fd, async ({ version_id, signer_name, signer_title }) => {
    const ctx = await requireCarrierUser({ owner: true });
    const { data: version } = await ctx.supabase
      .from("agreement_versions")
      .select("id, title, version, status, body_sha256, agreements!inner(audience, active)")
      .eq("id", version_id)
      .eq("status", "published")
      .maybeSingle();
    if (!version || version.agreements.audience !== "carrier" || !version.agreements.active) throw new AppError("This agreement version is no longer available. Refresh the page.");
    const h = await headers();
    // Acceptance evidence (IP, browser, hash) is written server-side so a client cannot forge it;
    // the database trigger re-checks owner membership, the published status and the hash.
    const { data: acceptance, error } = await createSupabaseAdminClient()
      .from("agreement_acceptances")
      .insert({
        agreement_version_id: version.id,
        carrier_id: ctx.membership.carrierId,
        user_id: ctx.userId,
        signer_name,
        signer_title,
        ip_address: clientIp(h),
        user_agent: userAgent(h),
        document_hash: version.body_sha256,
      })
      .select("accepted_at")
      .single();
    if (error) throw new DbError(error);
    const { timezone } = await getOperationsSettings();
    await sendEmailSafely({
      to: ctx.email,
      template: "agreement_accepted",
      data: { signerName: signer_name, agreementTitle: version.title, version: version.version, acceptedAt: formatDateTime(acceptance.accepted_at, timezone), documentHash: version.body_sha256 },
      carrierId: ctx.membership.carrierId,
      visibility: "carrier",
    });
    return null;
  });
}

// ---- Loads --------------------------------------------------------------------
export async function respondToLoad(fd: FormData): Promise<ActionResult<null>> {
  const schema = z
    .object({ load_id: z.uuid(), decision: z.enum(["approved", "rejected"]), note: formOptionalText(2000) })
    .refine((v) => v.decision === "approved" || (v.note && v.note.length >= 3), { path: ["note"], message: "Tell your dispatcher why you are passing on this load" });
  return runFormAction(schema, fd, async ({ load_id, decision, note }) => {
    const ctx = await requireCarrierUser({ owner: true });
    const { error } = await ctx.supabase.rpc("respond_to_proposed_load", { p_load_id: load_id, p_decision: decision, p_note: note ?? undefined });
    if (error) throw new DbError(error);
    await trackServer(decision === "approved" ? "load_approved" : "load_rejected", ctx.membership.carrierId, { via: "portal" });
    await notifyDispatcher(load_id, decision === "approved" ? "Carrier approved the load" : `Carrier rejected the load${note ? `: ${note}` : ""}`);
    return null;
  });
}

/** Creates an internal task so the dispatcher sees the carrier's decision immediately. */
async function notifyDispatcher(loadId: string, title: string) {
  const admin = createSupabaseAdminClient();
  const { data: load } = await admin.from("loads").select("id, reference, carrier_id, dispatcher_id").eq("id", loadId).single();
  if (!load) return;
  await admin.from("tasks").insert({
    title: `${title} (${load.reference})`.slice(0, 200),
    kind: "load",
    carrier_id: load.carrier_id,
    load_id: load.id,
    assigned_to: load.dispatcher_id,
    priority: "high",
    source: "system",
    dedupe_key: `load-decision:${load.id}:${Date.now() - (Date.now() % 60_000)}`,
  });
}

export async function addCarrierLoadNote(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ load_id: z.uuid(), body: requiredText("Message", 5000) }), fd, async ({ load_id, body }) => {
    const ctx = await requireCarrierUser();
    const { error } = await ctx.supabase
      .from("load_notes")
      .insert({ load_id, carrier_id: ctx.membership.carrierId, visibility: "carrier", kind: "note", body, author_id: ctx.userId });
    if (error) throw new DbError(error);
    return null;
  });
}

// ---- Preferences --------------------------------------------------------------
export async function saveOperatingPreferences(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    min_rate_per_mile: formOptionalNumber(0, 50, "Minimum rate"),
    desired_weekly_gross: formOptionalNumber(0, 1_000_000, "Weekly gross goal"),
    max_deadhead_miles: formOptionalNumber(0, 2000, "Maximum deadhead"),
    days_available: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(DAYS))),
    home_base_city: formOptionalText(100),
    home_base_state: formOptionalText(2),
    phone: formOptionalText(40),
    email: z.preprocess((v) => (v === "" ? undefined : v), emailSchema.optional()),
    factoring_status: z.enum(["none", "factoring", "quick_pay"]),
    factoring_company_name: formOptionalText(200),
    preferences_notes: formOptionalText(2000),
  });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await requireCarrierUser({ owner: true });
    if (v.factoring_status === "factoring" && !v.factoring_company_name) throw new AppError("Enter your factoring company's name.");
    const { error } = await ctx.supabase
      .from("carriers")
      .update({
        min_rate_per_mile: v.min_rate_per_mile ?? null,
        desired_weekly_gross: v.desired_weekly_gross ?? null,
        max_deadhead_miles: v.max_deadhead_miles ?? null,
        days_available: v.days_available,
        home_base_city: v.home_base_city ?? null,
        home_base_state: v.home_base_state?.toUpperCase() ?? null,
        phone: v.phone ?? null,
        email: v.email ?? null,
        factoring_status: v.factoring_status,
        factoring_company_name: v.factoring_status === "factoring" ? (v.factoring_company_name ?? null) : null,
        preferences_notes: v.preferences_notes ?? null,
      })
      .eq("id", ctx.membership.carrierId);
    if (error) throw new DbError(error);
    return null;
  });
}

// ---- Billing --------------------------------------------------------------------
export async function payInvoice(fd: FormData): Promise<ActionResult<null>> {
  const result = await runFormAction(z.object({ invoice_id: z.uuid() }), fd, async ({ invoice_id }) => {
    const ctx = await requireCarrierUser({ owner: true });
    await enforceRateLimit("checkout", ctx.userId);
    if (!(await getFeatureFlag("online_invoice_payments")) || !payments().online) {
      throw new AppError("Online payment is not available. Use the payment instructions on the invoice.");
    }
    const { data: invoice } = await ctx.supabase.from("invoices").select("id, invoice_number, carrier_id, status, balance_due").eq("id", invoice_id).maybeSingle();
    if (!invoice || invoice.carrier_id !== ctx.membership.carrierId) throw new AppError("Invoice not found.", "not_found");
    const amountCents = toCents(invoice.balance_due);
    if (invoice.status !== "open" || amountCents <= 0n) throw new AppError("This invoice has no balance due.");
    const session = await payments().createCheckout({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      carrierId: invoice.carrier_id,
      amountCents,
      customerEmail: ctx.email,
      successPath: `/portal/billing/invoices/${invoice.id}?payment=success`,
      cancelPath: `/portal/billing/invoices/${invoice.id}?payment=cancelled`,
    });
    // Record the session so staff can see an attempt is in progress; the webhook records the payment.
    await createSupabaseAdminClient().from("invoices").update({ stripe_checkout_session_id: session.id }).eq("id", invoice.id);
    return session.url;
  });
  if (result.ok) redirect(result.data);
  return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
}

// ---- Team -------------------------------------------------------------------------
export async function inviteTeamMember(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ email: emailSchema }), fd, async ({ email }) => {
    const ctx = await requireCarrierUser({ owner: true });
    await sendCarrierInvitation(ctx.supabase, { carrierId: ctx.membership.carrierId, email, role: "carrier_member", invitedBy: ctx.userId, inviterName: ctx.profile?.full_name });
    return null;
  });
}

export async function removeTeamMember(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ member_id: z.uuid() }), fd, async ({ member_id }) => {
    const ctx = await requireCarrierUser({ owner: true });
    const { data, error } = await ctx.supabase
      .from("organization_members")
      .update({ status: "removed", removed_at: new Date().toISOString(), removed_by: ctx.userId })
      .eq("id", member_id)
      .eq("role", "carrier_member")
      .select("id");
    if (error) throw new DbError(error);
    if (!data?.length) throw new AppError("That team member was not found.");
    return null;
  });
}

export async function revokeTeamInvitation(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ invitation_id: z.uuid() }), fd, async ({ invitation_id }) => {
    const ctx = await requireCarrierUser({ owner: true });
    const { error } = await ctx.supabase.from("organization_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", invitation_id).is("accepted_at", null);
    if (error) throw new DbError(error);
    return null;
  });
}

// ---- Support & account --------------------------------------------------------
export async function createSupportRequest(fd: FormData): Promise<ActionResult<null>> {
  const categories = Object.keys(SUPPORT_CATEGORIES).filter((c) => c !== "cancellation") as [string, ...string[]];
  const schema = z.object({ category: z.enum(categories), subject: requiredText("Subject", 200), body: requiredText("Details", 5000).min(10, "Add a few details"), load_id: formOptionalUuid });
  return runFormAction(schema, fd, async ({ category, subject, body, load_id }) => {
    const ctx = await requireCarrierUser();
    const { data: request, error } = await ctx.supabase
      .from("support_requests")
      .insert({ carrier_id: ctx.membership.carrierId, category, subject, body, load_id: load_id ?? null, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) throw new DbError(error);
    await sendEmailSafely({
      to: ctx.email,
      template: "support_request_confirmation",
      data: { name: ctx.profile?.full_name ?? "there", subject, reference: request.id.slice(0, 8).toUpperCase(), portalUrl: absoluteUrl("/portal/support") },
      carrierId: ctx.membership.carrierId,
      visibility: "carrier",
    });
    for (const to of adminNotificationEmails()) {
      await sendEmailSafely({
        to,
        template: "admin_support_request",
        data: { carrierName: ctx.membership.carrierName ?? "Carrier", category: SUPPORT_CATEGORIES[category as keyof typeof SUPPORT_CATEGORIES], subject, reviewUrl: absoluteUrl(`/dashboard/support/${request.id}`) },
        carrierId: ctx.membership.carrierId,
      });
    }
    return null;
  });
}

export async function requestCancellation(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({ reason: requiredText("Reason", 2000).min(3), confirm: formBool });
  return runFormAction(schema, fd, async ({ reason, confirm }) => {
    const ctx = await requireCarrierUser({ owner: true });
    if (!confirm) throw new AppError("Confirm that you want to end the dispatch service.");
    const { error } = await ctx.supabase.rpc("request_carrier_cancellation", { p_carrier_id: ctx.membership.carrierId, p_reason: reason });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function updateMyProfile(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({ full_name: requiredText("Name", 200), phone: formOptionalText(40), title: formOptionalText(120) });
  return runFormAction(schema, fd, async ({ full_name, phone, title }) => {
    const ctx = await requireCarrierUser();
    const { error } = await ctx.supabase.from("profiles").update({ full_name, phone: phone ?? null, title: title ?? null }).eq("id", ctx.userId);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function saveNotificationPreferences(fd: FormData): Promise<ActionResult<null>> {
  const categories = ["load_updates", "documents", "billing"] as const;
  const schema = z.object(Object.fromEntries(categories.map((c) => [c, formBool])) as Record<(typeof categories)[number], typeof formBool>);
  return runFormAction(schema, fd, async (v) => {
    const ctx = await requireCarrierUser();
    const rows = categories.map((category) => ({ user_id: ctx.userId, category, email_enabled: v[category] }));
    const { error } = await ctx.supabase.from("notification_preferences").upsert(rows, { onConflict: "user_id,category" });
    if (error) throw new DbError(error);
    return null;
  });
}


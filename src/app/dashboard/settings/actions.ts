"use server";

import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { type AuthContext, isElevated, requireStaff } from "@/lib/auth/session";
import { isPlaceholder } from "@/config/business";
import type { Json } from "@/lib/db/database.types";
import { sendEmailSafely } from "@/lib/email/send";
import { TEMPLATE_LABELS } from "@/lib/email/templates";
import { AppError } from "@/lib/errors";
import { createAuthLink } from "@/lib/invitations";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  applicationQuestionSchema,
  getApplicationQuestions,
  getBusinessProfile,
  getEmailTemplateOverrides,
  getOperationsSettings,
  notificationSchedulesSchema,
  operationsSettingsSchema,
} from "@/lib/settings";
import { emailSchema, formBool, formOptionalDate, formOptionalText, formOptionalUuid, requiredText } from "@/lib/validation/common";

async function admin() {
  return requireStaff({ admin: true });
}

/** Super admin with a verified second factor in this session (see isElevated). */
async function elevated(): Promise<AuthContext> {
  const ctx = await requireStaff({ superAdmin: true });
  if (!isElevated(ctx)) {
    throw new AppError("Verify with two-step authentication (Settings → Security) before changing security-sensitive settings.", "forbidden");
  }
  return ctx;
}

async function writeSetting(ctx: AuthContext, key: string, value: unknown) {
  const { data, error } = await ctx.supabase.from("app_settings").update({ value: value as Json, updated_by: ctx.userId }).eq("key", key).select("key");
  if (error) throw new DbError(error);
  if (!data?.length) throw new AppError("You do not have permission to change this setting.", "forbidden");
}

// ---- Business profile ------------------------------------------------------
export async function saveBusinessProfile(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    brandName: requiredText("Brand name", 80),
    legalEntity: requiredText("Legal entity", 160),
    email: emailSchema,
    phone: requiredText("Phone", 40),
    address: requiredText("Address", 200),
  });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await admin();
    await writeSetting(ctx, "business_profile", v);
    return null;
  });
}

// ---- Operations & notification schedules ----------------------------------
export async function saveOperationsSettings(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    timezone: z.enum(["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"]),
    cancellation_notice_days: z.coerce.number().int().min(0).max(90),
    statement_due_days: z.coerce.number().int().min(0).max(60),
    auto_issue_statements: formBool,
  });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await admin();
    await writeSetting(ctx, "operations", operationsSettingsSchema.parse(v));
    return null;
  });
}

export async function saveNotificationSchedules(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    document_reminder_days: z
      .string()
      .trim()
      .regex(/^\d{1,3}(\s*,\s*\d{1,3})*$/, "Enter days separated by commas, e.g. 30, 14, 7, 0")
      .transform((v) => [...new Set(v.split(",").map((d) => Number(d.trim())))].sort((a, b) => b - a)),
    invoice_reminder_days_before_due: z.coerce.number().int().min(0).max(30),
    invoice_overdue_reminder_interval_days: z.coerce.number().int().min(1).max(60),
    stale_application_days: z.coerce.number().int().min(1).max(60),
    information_request_reminder_days: z.coerce.number().int().min(1).max(60),
    onboarding_reminder_days: z.coerce.number().int().min(1).max(60),
    daily_summary_enabled: formBool,
  });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await admin();
    await writeSetting(ctx, "notification_schedules", notificationSchedulesSchema.parse(v));
    return null;
  });
}

// ---- Email templates -------------------------------------------------------
export async function saveEmailTemplateOverride(fd: FormData): Promise<ActionResult<null>> {
  const keys = Object.keys(TEMPLATE_LABELS) as [string, ...string[]];
  const schema = z.object({ template: z.enum(keys), subject: formOptionalText(200), intro: formOptionalText(1000) });
  return runFormAction(schema, fd, async ({ template, subject, intro }) => {
    const ctx = await admin();
    const current = await getEmailTemplateOverrides();
    const next = { ...current };
    if (subject || intro) next[template] = { ...(subject ? { subject } : {}), ...(intro ? { intro } : {}) };
    else delete next[template];
    await writeSetting(ctx, "email_templates", next);
    return null;
  });
}

// ---- Application questions -------------------------------------------------
export async function addApplicationQuestion(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    label: requiredText("Question", 200).min(3),
    type: z.enum(["text", "textarea", "yes_no", "select"]),
    options: formOptionalText(1000),
    required: formBool,
  });
  return runFormAction(schema, fd, async ({ label, type, options, required }) => {
    const ctx = await admin();
    const questions = await getApplicationQuestions();
    if (questions.length >= 20) throw new AppError("You can add up to 20 questions.");
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "question";
    let id = /^[a-z]/.test(base) ? base : `q_${base}`;
    while (questions.some((q) => q.id === id)) id = `${id.slice(0, 36)}_${Math.floor(Math.random() * 90 + 10)}`;
    const question = applicationQuestionSchema.parse({
      id,
      label,
      type,
      required,
      ...(type === "select" ? { options: (options ?? "").split("\n").map((o) => o.trim()).filter(Boolean) } : {}),
    });
    if (type === "select" && !question.options?.length) throw new AppError("Add at least one option (one per line).");
    await writeSetting(ctx, "application_questions", [...questions, question]);
    return null;
  });
}

export async function removeApplicationQuestion(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ id: z.string().max(60) }), fd, async ({ id }) => {
    const ctx = await admin();
    const questions = await getApplicationQuestions();
    await writeSetting(ctx, "application_questions", questions.filter((q) => q.id !== id));
    return null;
  });
}

// ---- Pricing (fee plans) ---------------------------------------------------
export async function saveFeePlan(fd: FormData): Promise<ActionResult<null>> {
  const schema = z
    .object({
      id: formOptionalUuid,
      key: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, "Use lowercase letters, numbers and underscores").optional()),
      name: requiredText("Name", 120),
      description: formOptionalText(1000),
      model: z.enum(["percentage", "flat_weekly"]),
      percentage_display: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().gt(0).lt(100).optional()),
      flat_weekly_amount: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 300.00").optional()),
      include_detention: formBool,
      include_layover: formBool,
      include_tonu: formBool,
      include_other: formBool,
      is_default: formBool,
      active: formBool,
    })
    .superRefine((v, c) => {
      if (v.model === "percentage" && v.percentage_display === undefined) c.addIssue({ code: "custom", path: ["percentage_display"], message: "Enter the percentage" });
      if (v.model === "flat_weekly" && !v.flat_weekly_amount) c.addIssue({ code: "custom", path: ["flat_weekly_amount"], message: "Enter the weekly amount" });
      if (!v.id && !v.key) c.addIssue({ code: "custom", path: ["key"], message: "Enter a key" });
    });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await admin();
    const row = {
      name: v.name,
      description: v.description ?? null,
      model: v.model,
      percentage: v.model === "percentage" ? Number((v.percentage_display! / 100).toFixed(4)) : null,
      flat_weekly_amount: v.model === "flat_weekly" ? Number(v.flat_weekly_amount) : null,
      include_detention: v.include_detention,
      include_layover: v.include_layover,
      include_tonu: v.include_tonu,
      include_other: v.include_other,
      active: v.active || v.is_default,
    };
    if (v.is_default) {
      const { error } = await ctx.supabase.from("fee_plans").update({ is_default: false }).eq("is_default", true).neq("id", v.id ?? "00000000-0000-0000-0000-000000000000");
      if (error) throw new DbError(error);
    }
    const { error } = v.id
      ? await ctx.supabase.from("fee_plans").update({ ...row, is_default: v.is_default }).eq("id", v.id)
      : await ctx.supabase.from("fee_plans").insert({ ...row, key: v.key!, is_default: v.is_default });
    if (error) throw new DbError(error);
    return null;
  });
}

// ---- Equipment types -------------------------------------------------------
export async function saveEquipmentType(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({ key: z.string().max(40), label: requiredText("Label", 80), description: formOptionalText(500), active: formBool, sort_order: z.coerce.number().int().min(0).max(1000) });
  return runFormAction(schema, fd, async ({ key, ...v }) => {
    const ctx = await admin();
    const { error } = await ctx.supabase.from("equipment_types").update({ ...v, description: v.description ?? null }).eq("key", key);
    if (error) throw new DbError(error);
    return null;
  });
}

// ---- Document requirements -------------------------------------------------
export async function saveDocumentRequirement(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    id: z.uuid(),
    label: requiredText("Label", 120),
    description: formOptionalText(500),
    required_for_application: formBool,
    required_for_activation: formBool,
    tracks_expiration: formBool,
    reminder_days: z
      .string()
      .trim()
      .regex(/^(\d{1,3}(\s*,\s*\d{1,3})*)?$/, "Enter days separated by commas")
      .transform((v) => (v ? [...new Set(v.split(",").map((d) => Number(d.trim())))].sort((a, b) => b - a) : [])),
    active: formBool,
  });
  return runFormAction(schema, fd, async ({ id, ...v }) => {
    const ctx = await admin();
    const { error } = await ctx.supabase.from("document_requirements").update({ ...v, description: v.description ?? null }).eq("id", id);
    if (error) throw new DbError(error);
    return null;
  });
}

// ---- Agreements ------------------------------------------------------------
export async function createAgreementVersion(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    agreement_id: z.uuid(),
    version: z.string().trim().regex(/^[0-9A-Za-z.\-]{1,20}$/, "Use a short version like 1.0 or 2026-10"),
    title: requiredText("Title", 200),
    body_markdown: requiredText("Agreement text", 100000).min(50, "Paste the full agreement text"),
  });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await admin();
    const { error } = await ctx.supabase.from("agreement_versions").insert({ ...v, created_by: ctx.userId });
    if (error) throw new DbError(error.code === "23505" ? { ...error, message: "That version number already exists for this agreement." } : error);
    return null;
  });
}

export async function updateAgreementDraft(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({ id: z.uuid(), title: requiredText("Title", 200), body_markdown: requiredText("Agreement text", 100000).min(50) });
  return runFormAction(schema, fd, async ({ id, title, body_markdown }) => {
    const ctx = await admin();
    const { error } = await ctx.supabase.from("agreement_versions").update({ title, body_markdown }).eq("id", id).eq("status", "draft");
    if (error) throw new DbError(error);
    return null;
  });
}

/** Fills template placeholders from settings; refuses while business details are still placeholders. */
export async function publishAgreementVersion(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ id: z.uuid(), confirm: formBool }), fd, async ({ id, confirm }) => {
    const ctx = await admin();
    if (!confirm) throw new AppError("Confirm that this version has been reviewed before publishing.");
    const [profile, ops] = await Promise.all([getBusinessProfile(), getOperationsSettings()]);
    if (isPlaceholder(profile.legalEntity)) throw new AppError("Set the company's legal entity name in Settings → Business profile before publishing agreements.");
    const { data: v } = await ctx.supabase.from("agreement_versions").select("id, body_markdown, status").eq("id", id).single();
    if (!v || v.status !== "draft") throw new AppError("Only drafts can be published.");
    const body = v.body_markdown.replaceAll("{{legal_entity}}", profile.legalEntity).replaceAll("{{cancellation_notice_days}}", String(ops.cancellation_notice_days));
    if (/\{\{[a-z_]+\}\}/.test(body)) throw new AppError("The agreement still contains unfilled {{placeholders}}. Edit the draft first.");
    const { error } = await ctx.supabase.from("agreement_versions").update({ body_markdown: body, status: "published" }).eq("id", id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function recordAttorneyApproval(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({ id: z.uuid(), attorney_approved_by_name: requiredText("Attorney name", 200).min(3), approved_on: formOptionalDate });
  return runFormAction(schema, fd, async ({ id, attorney_approved_by_name, approved_on }) => {
    const ctx = await elevated();
    const { error } = await ctx.supabase
      .from("agreement_versions")
      .update({
        legal_review_status: "attorney_approved",
        attorney_approved_by_name,
        attorney_approved_at: approved_on ? `${approved_on}T12:00:00Z` : new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new DbError(error);
    return null;
  });
}

// ---- Feature flags, lease-on and security ----------------------------------
export async function setFeatureFlag(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ key: z.string().max(80), enabled: formBool }), fd, async ({ key, enabled }) => {
    const base = await admin();
    const { data: flag } = await base.supabase.from("feature_flags").select("key, is_sensitive").eq("key", key).single();
    if (!flag) throw new AppError("Unknown feature flag.", "not_found");
    const ctx = flag.is_sensitive ? await elevated() : base;
    const { data, error } = await ctx.supabase.from("feature_flags").update({ enabled }).eq("key", key).select("key");
    if (error) throw new DbError(error);
    if (!data?.length) throw new AppError("You do not have permission to change this flag.", "forbidden");
    return null;
  });
}

export async function saveAuthorityProfile(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({
    legal_name: formOptionalText(200),
    usdot_number: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{1,8}$/, "Digits only").optional()),
    mc_number: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{1,8}$/, "Digits only").optional()),
    authority_effective_date: formOptionalDate,
    insurance_filing_verified: formBool,
    boc3_verified: formBool,
    compliance_administrator_id: formOptionalUuid,
    attorney_approved_lease_version_id: formOptionalUuid,
    notes: formOptionalText(2000),
  });
  return runFormAction(schema, fd, async (v) => {
    const ctx = await elevated();
    const { data: existing } = await ctx.supabase.from("authority_profiles").select("*").eq("kind", "company").maybeSingle();
    const now = new Date().toISOString();
    const row = {
      kind: "company",
      legal_name: v.legal_name ?? null,
      usdot_number: v.usdot_number ?? null,
      mc_number: v.mc_number ?? null,
      authority_effective_date: v.authority_effective_date ?? null,
      insurance_filing_verified_at: v.insurance_filing_verified ? (existing?.insurance_filing_verified_at ?? now) : null,
      insurance_filing_verified_by: v.insurance_filing_verified ? (existing?.insurance_filing_verified_by ?? ctx.userId) : null,
      boc3_verified_at: v.boc3_verified ? (existing?.boc3_verified_at ?? now) : null,
      boc3_verified_by: v.boc3_verified ? (existing?.boc3_verified_by ?? ctx.userId) : null,
      compliance_administrator_id: v.compliance_administrator_id ?? null,
      attorney_approved_lease_version_id: v.attorney_approved_lease_version_id ?? null,
      notes: v.notes ?? null,
    };
    const { error } = existing
      ? await ctx.supabase.from("authority_profiles").update(row).eq("id", existing.id)
      : await ctx.supabase.from("authority_profiles").insert(row);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function setRequireAdminMfa(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ require_admin_mfa: formBool }), fd, async ({ require_admin_mfa }) => {
    const ctx = await elevated();
    await writeSetting(ctx, "security", { require_admin_mfa });
    return null;
  });
}

// ---- Staff users -----------------------------------------------------------
const ROLE_LABELS = { dispatcher: "Dispatcher", admin: "Administrator", super_admin: "Super administrator" } as const;

export async function inviteStaff(fd: FormData): Promise<ActionResult<null>> {
  const schema = z.object({ email: emailSchema, full_name: requiredText("Name", 120), role: z.enum(["dispatcher", "admin", "super_admin"]) });
  return runFormAction(schema, fd, async ({ email, full_name, role }) => {
    const ctx = role === "dispatcher" ? await admin() : await elevated();
    await enforceRateLimit("invite", ctx.userId);
    const { url, userId } = await createAuthLink(email, "/invite/accept");
    if (!userId) throw new AppError("We could not create the account for that email.");
    const { data: membership } = await ctx.supabase.from("organization_members").select("id").eq("user_id", userId).eq("status", "active").maybeSingle();
    if (membership) throw new AppError("That email belongs to a carrier portal user. Staff and carrier accounts must be separate.");
    const { error } = await ctx.supabase.from("user_roles").insert({ user_id: userId, role, granted_by: ctx.userId });
    if (error) throw new DbError(error.code === "23505" ? { ...error, message: "That person already has this role." } : error);
    await ctx.supabase.from("profiles").update({ full_name }).eq("id", userId).is("full_name", null);
    await sendEmailSafely({ to: email, template: "staff_invitation", data: { inviterName: ctx.profile?.full_name, roleLabel: ROLE_LABELS[role], acceptUrl: url } });
    return null;
  });
}

export async function revokeStaffRole(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ user_id: z.uuid(), role: z.enum(["dispatcher", "admin", "super_admin"]) }), fd, async ({ user_id, role }) => {
    const ctx = role === "dispatcher" ? await admin() : await elevated();
    if (user_id === ctx.userId) throw new AppError("You cannot remove your own role.");
    const { data, error } = await ctx.supabase
      .from("user_roles")
      .update({ revoked_at: new Date().toISOString(), revoked_by: ctx.userId })
      .eq("user_id", user_id)
      .eq("role", role)
      .is("revoked_at", null)
      .select("id");
    if (error) throw new DbError(error);
    if (!data?.length) throw new AppError("That role was not found or you cannot change it.");
    return null;
  });
}

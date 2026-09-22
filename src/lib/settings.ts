import "server-only";
import { cache } from "react";
import { z } from "zod";
import { type BusinessConfig, business } from "@/config/business";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Runtime settings: defaults come from src/config/business.ts and the
 * reference-data migration; administrators override them from the dashboard
 * (stored in public.app_settings). Reads fall back to defaults if the
 * database is unavailable so public pages keep rendering.
 */
const businessOverrideSchema = z
  .object({
    brandName: z.string().min(1).max(80),
    legalEntity: z.string().min(1).max(160),
    email: z.string().min(3).max(254),
    phone: z.string().min(1).max(40),
    address: z.string().min(1).max(200),
  })
  .partial();

export type BusinessProfile = BusinessConfig;

async function readSetting(key: string): Promise<unknown> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
    return data?.value ?? null;
  } catch {
    return null;
  }
}

export const getBusinessProfile = cache(async (): Promise<BusinessProfile> => {
  const override = businessOverrideSchema.safeParse((await readSetting("business_profile")) ?? {});
  return override.success ? { ...business, ...override.data } : business;
});

export const operationsSettingsSchema = z.object({
  timezone: z.string().default(business.operations.timezone),
  cancellation_notice_days: z.number().int().min(0).max(90).default(business.operations.cancellationNoticeDays),
  statement_due_days: z.number().int().min(0).max(60).default(business.operations.invoiceDueDays),
  auto_issue_statements: z.boolean().default(false),
});
export type OperationsSettings = z.infer<typeof operationsSettingsSchema>;

export const getOperationsSettings = cache(async (): Promise<OperationsSettings> => {
  const parsed = operationsSettingsSchema.safeParse((await readSetting("operations")) ?? {});
  return parsed.success ? parsed.data : operationsSettingsSchema.parse({});
});

export const notificationSchedulesSchema = z.object({
  document_reminder_days: z.array(z.number().int().min(0).max(120)).default([30, 14, 7, 0]),
  invoice_reminder_days_before_due: z.number().int().min(0).max(30).default(2),
  invoice_overdue_reminder_interval_days: z.number().int().min(1).max(60).default(7),
  stale_application_days: z.number().int().min(1).max(60).default(3),
  information_request_reminder_days: z.number().int().min(1).max(60).default(5),
  onboarding_reminder_days: z.number().int().min(1).max(60).default(3),
  daily_summary_enabled: z.boolean().default(true),
});
export type NotificationSchedules = z.infer<typeof notificationSchedulesSchema>;

export const getNotificationSchedules = cache(async (): Promise<NotificationSchedules> => {
  const parsed = notificationSchedulesSchema.safeParse((await readSetting("notification_schedules")) ?? {});
  return parsed.success ? parsed.data : notificationSchedulesSchema.parse({});
});

export const emailTemplateOverridesSchema = z.record(
  z.string(),
  z.object({ subject: z.string().max(200).optional(), intro: z.string().max(1000).optional() }),
);
export type EmailTemplateOverrides = z.infer<typeof emailTemplateOverridesSchema>;

export const getEmailTemplateOverrides = cache(async (): Promise<EmailTemplateOverrides> => {
  const parsed = emailTemplateOverridesSchema.safeParse((await readSetting("email_templates")) ?? {});
  return parsed.success ? parsed.data : {};
});

export const applicationQuestionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  label: z.string().min(3).max(200),
  type: z.enum(["text", "textarea", "yes_no", "select"]),
  options: z.array(z.string().min(1).max(80)).max(20).optional(),
  required: z.boolean().default(false),
});
export type ApplicationQuestion = z.infer<typeof applicationQuestionSchema>;

export const getApplicationQuestions = cache(async (): Promise<ApplicationQuestion[]> => {
  const parsed = z.array(applicationQuestionSchema).max(20).safeParse((await readSetting("application_questions")) ?? []);
  return parsed.success ? parsed.data : [];
});

export async function getFeatureFlag(key: string): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("feature_flags").select("enabled").eq("key", key).maybeSingle();
    return data?.enabled === true;
  } catch {
    return false;
  }
}

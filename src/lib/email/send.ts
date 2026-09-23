import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { type EmailBrand, renderEmail } from "./layout";
import { type TemplateData, type TemplateKey, buildTemplate } from "./templates";
import { serverEnv } from "@/lib/env";
import { getBusinessProfile, getEmailTemplateOverrides } from "@/lib/settings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Transactional email with an outbox. Each message is recorded in
 * public.communications before delivery, then marked sent or failed. Failed
 * messages are retried with backoff by the notification-retry job. A
 * dedupe key makes reminders idempotent across job re-runs.
 *
 * Drivers:
 *   resend  — production delivery through Resend
 *   outbox  — development/E2E: writes JSON files to EMAIL_DEV_OUTBOX_DIR
 *   console — development fallback: logs template and masked recipient only
 */
export interface SendEmailOptions<K extends TemplateKey> {
  to: string;
  template: K;
  data: TemplateData[K];
  carrierId?: string | null;
  applicationId?: string | null;
  loadId?: string | null;
  dedupeKey?: string;
  visibility?: "internal" | "carrier";
  replyTo?: string;
}

export interface Delivery {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface DeliveryResult {
  provider: string;
  messageId: string | null;
}

export const MAX_EMAIL_ATTEMPTS = 5;

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

export function nextAttemptDelayMinutes(attempts: number): number {
  return Math.min(5 * 2 ** Math.max(attempts - 1, 0), 360);
}

async function brand(): Promise<EmailBrand> {
  const profile = await getBusinessProfile();
  return {
    brandName: profile.brandName,
    legalEntity: profile.legalEntity,
    address: profile.address,
    supportEmail: profile.email,
    phone: profile.phone,
  };
}

export async function deliver(message: Delivery): Promise<DeliveryResult> {
  const env = serverEnv();
  const from = env.EMAIL_FROM ?? "Dispatch Services <no-reply@example.com>";
  switch (env.emailDriver) {
    case "resend": {
      const resend = new Resend(env.RESEND_API_KEY);
      const { data, error } = await resend.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo ?? env.EMAIL_REPLY_TO,
      });
      if (error) throw new Error(`resend: ${error.message}`);
      return { provider: "resend", messageId: data?.id ?? null };
    }
    case "outbox": {
      const dir = env.EMAIL_DEV_OUTBOX_DIR ?? path.join(process.cwd(), ".local-stack", "outbox");
      await fs.mkdir(dir, { recursive: true });
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ from, ...message, sentAt: new Date().toISOString() }, null, 2));
      return { provider: "outbox", messageId: id };
    }
    default:
      console.info(`[email:console] "${message.subject}" → ${maskEmail(message.to)} (set RESEND_API_KEY to deliver)`);
      return { provider: "console", messageId: null };
  }
}

export async function sendEmail<K extends TemplateKey>(opts: SendEmailOptions<K>): Promise<{ status: "sent" | "failed" | "duplicate"; id?: string }> {
  const overrides = await getEmailTemplateOverrides();
  const content = buildTemplate(opts.template, opts.data, overrides[opts.template]);
  const rendered = renderEmail(content, await brand());
  const admin = createSupabaseAdminClient();

  const { data: row, error } = await admin
    .from("communications")
    .insert({
      carrier_id: opts.carrierId ?? null,
      application_id: opts.applicationId ?? null,
      load_id: opts.loadId ?? null,
      channel: "email",
      direction: "outbound",
      visibility: opts.visibility ?? "internal",
      template_key: opts.template,
      subject: rendered.subject,
      body_text: rendered.text,
      body_html: rendered.html,
      to_address: opts.to,
      status: "queued",
      dedupe_key: opts.dedupeKey ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { status: "duplicate" };
    // Recording failed; still attempt delivery so the recipient is not left without the message.
    console.error("[email] could not record communication", error.message);
  }

  try {
    const result = await deliver({ to: opts.to, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: opts.replyTo });
    if (row) {
      await admin
        .from("communications")
        .update({
          status: "sent",
          provider: result.provider,
          provider_message_id: result.messageId,
          attempts: 1,
          sent_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
    return { status: "sent", id: row?.id };
  } catch (deliveryError) {
    const message = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
    console.error(`[email] delivery failed for ${opts.template} → ${maskEmail(opts.to)}: ${message}`);
    if (row) {
      await admin
        .from("communications")
        .update({
          status: "failed",
          attempts: 1,
          error: message.slice(0, 1000),
          next_attempt_at: new Date(Date.now() + nextAttemptDelayMinutes(1) * 60_000).toISOString(),
        })
        .eq("id", row.id);
    }
    return { status: "failed", id: row?.id };
  }
}

/** Best-effort send that never throws (used after the primary action succeeded). */
export async function sendEmailSafely<K extends TemplateKey>(opts: SendEmailOptions<K>): Promise<void> {
  try {
    await sendEmail(opts);
  } catch (error) {
    console.error("[email] unexpected failure", error instanceof Error ? error.message : error);
  }
}

/**
 * Re-attempts a failed outbound email from its stored rendering. Used by the
 * retry job and the dashboard "Retry" button; gives up after MAX_EMAIL_ATTEMPTS.
 */
export async function retryCommunication(id: string): Promise<"sent" | "failed" | "skipped"> {
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("communications")
    .select("id, status, channel, direction, to_address, subject, body_html, body_text, attempts")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.channel !== "email" || row.direction !== "outbound" || row.status !== "failed" || !row.to_address) return "skipped";
  if (row.attempts >= MAX_EMAIL_ATTEMPTS) {
    await admin.from("communications").update({ status: "skipped", next_attempt_at: null }).eq("id", id);
    return "skipped";
  }
  const attempts = row.attempts + 1;
  try {
    const result = await deliver({ to: row.to_address, subject: row.subject ?? "", html: row.body_html ?? "", text: row.body_text ?? "" });
    await admin
      .from("communications")
      .update({ status: "sent", provider: result.provider, provider_message_id: result.messageId, attempts, sent_at: new Date().toISOString(), error: null, next_attempt_at: null })
      .eq("id", id);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from("communications")
      .update({
        status: attempts >= MAX_EMAIL_ATTEMPTS ? "skipped" : "failed",
        attempts,
        error: message.slice(0, 1000),
        next_attempt_at: attempts >= MAX_EMAIL_ATTEMPTS ? null : new Date(Date.now() + nextAttemptDelayMinutes(attempts) * 60_000).toISOString(),
      })
      .eq("id", id);
    return "failed";
  }
}

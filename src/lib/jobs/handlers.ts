import "server-only";
import { rotateResumeToken } from "@/lib/applications/service";
import { notifyInvoiceDue, notifyStatementIssued } from "@/lib/billing";
import { addDays, daysUntil, formatDate, localDate, previousWeekStart } from "@/lib/domain/dates";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { adminNotificationEmails } from "@/lib/env";
import { retryCommunication, sendEmailSafely } from "@/lib/email/send";
import type { JobResult } from "@/lib/jobs/runner";
import { getNotificationSchedules, getOperationsSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Scheduled job handlers. They run with the service role (no user session),
 * so each one scopes its own queries carefully and relies on dedupe keys to
 * stay idempotent when retried.
 */

async function ownerEmails(carrierIds: string[]): Promise<Map<string, { name: string; emails: string[] }>> {
  const admin = createSupabaseAdminClient();
  const out = new Map<string, { name: string; emails: string[] }>();
  if (!carrierIds.length) return out;
  const { data: carriers } = await admin.from("carriers").select("id, legal_name, email, organization_id").in("id", carrierIds);
  for (const c of carriers ?? []) {
    const { data: owners } = await admin
      .from("organization_members")
      .select("profiles!organization_members_user_id_fkey(email)")
      .eq("organization_id", c.organization_id)
      .eq("status", "active")
      .eq("role", "carrier_owner");
    const emails = (owners ?? []).map((o) => o.profiles?.email).filter((e): e is string => Boolean(e));
    out.set(c.id, { name: c.legal_name, emails: emails.length ? emails : c.email ? [c.email] : [] });
  }
  return out;
}

/** Reminds carriers before insurance and other tracked documents expire; marks expired ones. */
export async function documentExpirationReminders(today: string): Promise<JobResult> {
  const admin = createSupabaseAdminClient();
  const [{ data: requirements }, schedules] = await Promise.all([
    admin.from("document_requirements").select("doc_type, label, reminder_days").eq("active", true).eq("tracks_expiration", true),
    getNotificationSchedules(),
  ]);
  const byType = new Map((requirements ?? []).map((r) => [r.doc_type, r]));
  const maxDays = Math.max(0, ...schedules.document_reminder_days, ...(requirements ?? []).flatMap((r) => r.reminder_days));
  const { data: docs } = await admin
    .from("documents")
    .select("id, carrier_id, doc_type, expires_on, status")
    .in("status", ["accepted"])
    .is("deleted_at", null)
    .not("carrier_id", "is", null)
    .not("expires_on", "is", null)
    .lte("expires_on", addDays(today, maxDays));
  const recipients = await ownerEmails([...new Set((docs ?? []).map((d) => d.carrier_id!))]);
  let sent = 0;
  let expired = 0;
  for (const d of docs ?? []) {
    const days = daysUntil(d.expires_on!, today);
    const req = byType.get(d.doc_type);
    const thresholds = req?.reminder_days.length ? req.reminder_days : schedules.document_reminder_days;
    const label = req?.label ?? DOCUMENT_TYPE_LABELS[d.doc_type];
    if (days < 0) {
      await admin.from("documents").update({ status: "expired" }).eq("id", d.id).eq("status", "accepted");
      await admin.from("tasks").upsert(
        { title: `Expired: ${label}`, kind: "documents", carrier_id: d.carrier_id, priority: "high", source: "system", dedupe_key: `doc-expired:${d.id}` },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      );
      expired++;
    }
    const threshold = days < 0 ? -1 : thresholds.find((t) => t === days);
    if (threshold === undefined) continue;
    const r = recipients.get(d.carrier_id!);
    for (const to of r?.emails ?? []) {
      await sendEmailSafely({
        to,
        template: "expiring_insurance_reminder",
        data: { carrierName: r!.name, documentLabel: label, expiresOn: formatDate(d.expires_on), daysRemaining: days, portalUrl: absoluteUrl("/portal/documents") },
        carrierId: d.carrier_id,
        visibility: "carrier",
        preferenceCategory: "documents",
        dedupeKey: `doc-expiry:${d.id}:${threshold}:${to}`,
      });
      sent++;
    }
  }
  return { documents_checked: docs?.length ?? 0, reminders: sent, marked_expired: expired };
}

/** Generates last week's statements for every activated carrier; optionally issues them. */
export async function weeklyStatements(now: Date): Promise<JobResult> {
  const admin = createSupabaseAdminClient();
  const ops = await getOperationsSettings();
  const period = previousWeekStart(now, ops.timezone);
  const periodEnd = addDays(period, 6);
  const [{ data: carriers }, { data: snapshots }] = await Promise.all([
    admin.from("carriers").select("id, status, activated_at, deactivated_at").not("activated_at", "is", null),
    admin.from("fee_snapshots").select("carrier_id").eq("statement_week", period),
  ]);
  const ids = new Set<string>((snapshots ?? []).map((s) => s.carrier_id));
  for (const c of carriers ?? []) {
    const activeInPeriod = c.activated_at!.slice(0, 10) <= periodEnd && (!c.deactivated_at || c.deactivated_at.slice(0, 10) >= period);
    if (activeInPeriod) ids.add(c.id);
  }
  let generated = 0;
  let issued = 0;
  for (const id of ids) {
    const { data: statementId, error } = await admin.rpc("generate_weekly_statement", { p_carrier_id: id, p_period_start: period });
    if (error || !statementId) throw new Error(`statement generation failed for a carrier: ${error?.message}`);
    generated++;
    if (ops.auto_issue_statements) {
      const { data: st } = await admin.from("weekly_statements").select("status").eq("id", statementId).single();
      if (st?.status === "draft") {
        const { error: issueError } = await admin.rpc("issue_weekly_statement", { p_statement_id: statementId, p_due_days: ops.statement_due_days });
        if (issueError) throw new Error(`statement issue failed: ${issueError.message}`);
        await notifyStatementIssued(statementId);
        issued++;
      }
    }
  }
  if (!ops.auto_issue_statements && generated) {
    await admin.from("tasks").upsert(
      { title: `Review and issue weekly statements (week of ${formatDate(period)})`, kind: "billing", priority: "normal", source: "system", dedupe_key: `statements-review:${period}` },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  }
  return { period_start: period, generated, issued };
}

/** Reminders before the due date and at a fixed interval once overdue. */
export async function invoiceReminders(today: string): Promise<JobResult> {
  const admin = createSupabaseAdminClient();
  const schedules = await getNotificationSchedules();
  const { data: invoices } = await admin.from("invoices").select("id, due_date").eq("status", "open").not("due_date", "is", null);
  let sent = 0;
  for (const inv of invoices ?? []) {
    const days = daysUntil(inv.due_date!, today);
    if (days === schedules.invoice_reminder_days_before_due) {
      sent += await notifyInvoiceDue(inv.id, { overdue: false, dedupeSuffix: `before:${inv.due_date}` });
    } else if (days < 0 && (-days - 1) % schedules.invoice_overdue_reminder_interval_days === 0) {
      // First reminder the day after the due date, then every interval days.
      sent += await notifyInvoiceDue(inv.id, { overdue: true, dedupeSuffix: `overdue:${today}` });
    }
  }
  return { open_invoices: invoices?.length ?? 0, reminders: sent };
}

/** Flags unreviewed applications for staff and nudges applicants who owe information. */
export async function staleApplicationFollowUp(now: Date): Promise<JobResult> {
  const admin = createSupabaseAdminClient();
  const schedules = await getNotificationSchedules();
  const staleBefore = new Date(now.getTime() - schedules.stale_application_days * 86_400_000).toISOString();
  const { data: stale } = await admin.from("carrier_applications").select("id, legal_name, submitted_at").eq("status", "submitted").lt("submitted_at", staleBefore);
  for (const a of stale ?? []) {
    await admin.from("tasks").upsert(
      { title: `Review application: ${a.legal_name ?? "unnamed"}`, kind: "application", application_id: a.id, priority: "high", source: "system", dedupe_key: `stale-application:${a.id}` },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  }
  const infoBefore = new Date(now.getTime() - schedules.information_request_reminder_days * 86_400_000).toISOString();
  const { data: waiting } = await admin
    .from("carrier_applications")
    .select("id, email, contact_name, information_request, reviewed_at")
    .eq("status", "information_requested")
    .lt("reviewed_at", infoBefore);
  let reminded = 0;
  for (const a of waiting ?? []) {
    if (!a.email || !a.information_request) continue;
    const { data: already } = await admin.from("communications").select("id").eq("dedupe_key", `info-reminder:${a.id}:${a.reviewed_at}`).maybeSingle();
    if (already) continue;
    const { token } = await rotateResumeToken(admin, a.id);
    await sendEmailSafely({
      to: a.email,
      template: "information_requested",
      data: { contactName: a.contact_name ?? "there", request: a.information_request, resumeUrl: absoluteUrl(`/apply/resume?token=${token}`) },
      applicationId: a.id,
      visibility: "carrier",
      dedupeKey: `info-reminder:${a.id}:${a.reviewed_at}`,
    });
    reminded++;
  }
  return { stale_applications: stale?.length ?? 0, information_reminders: reminded };
}

/** Reminds onboarding carriers about missing documents at a fixed interval. */
export async function onboardingReminders(today: string): Promise<JobResult> {
  const admin = createSupabaseAdminClient();
  const schedules = await getNotificationSchedules();
  const { data: carriers } = await admin.from("carriers").select("id, created_at").eq("status", "onboarding").is("deleted_at", null);
  const recipients = await ownerEmails((carriers ?? []).map((c) => c.id));
  let sent = 0;
  for (const c of carriers ?? []) {
    const age = daysUntil(today, c.created_at.slice(0, 10));
    if (age <= 0 || age % schedules.onboarding_reminder_days !== 0) continue;
    const { data: onboarding } = await admin.rpc("get_carrier_onboarding", { p_carrier_id: c.id });
    const steps = ((onboarding as { steps?: Array<{ key: string; label: string; complete: boolean; uploaded?: boolean }> } | null)?.steps ?? []).filter(
      (s) => !s.complete && s.key.startsWith("document:") && !s.uploaded,
    );
    if (!steps.length) continue;
    const r = recipients.get(c.id);
    for (const to of r?.emails ?? []) {
      await sendEmailSafely({
        to,
        template: "missing_document_reminder",
        data: { carrierName: r!.name, documents: steps.map((s) => s.label.replace(/ on file and accepted$/, "")), portalUrl: absoluteUrl("/portal/onboarding") },
        carrierId: c.id,
        visibility: "carrier",
        preferenceCategory: "documents",
        dedupeKey: `onboarding-reminder:${c.id}:${today}:${to}`,
      });
      sent++;
    }
  }
  return { onboarding_carriers: carriers?.length ?? 0, reminders: sent };
}

/** Morning summary for administrators. Carrier revenue and dispatch fees are listed separately. */
export async function dailyOperationsSummary(today: string): Promise<JobResult> {
  const schedules = await getNotificationSchedules();
  const recipients = adminNotificationEmails();
  if (!schedules.daily_summary_enabled || !recipients.length) return { skipped: true };
  const admin = createSupabaseAdminClient();
  const [proposed, active, apps, docs, overdue] = await Promise.all([
    admin.from("loads").select("id", { count: "exact", head: true }).eq("status", "proposed"),
    admin.from("loads").select("id", { count: "exact", head: true }).in("status", ["booked", "dispatched", "at_pickup", "loaded", "in_transit"]),
    admin.from("carrier_applications").select("id", { count: "exact", head: true }).in("status", ["submitted", "under_review"]),
    admin.from("documents").select("id", { count: "exact", head: true }).eq("status", "pending_review").is("deleted_at", null),
    admin.from("invoices").select("balance_due").eq("status", "open").lt("due_date", today),
  ]);
  const overdueTotal = (overdue.data ?? []).reduce((a, i) => a + Number(i.balance_due ?? 0), 0);
  const lines: Array<[string, string]> = [
    ["Loads awaiting carrier decision", String(proposed.count ?? 0)],
    ["Loads booked or moving", String(active.count ?? 0)],
    ["Applications to review", String(apps.count ?? 0)],
    ["Documents to review", String(docs.count ?? 0)],
    ["Overdue dispatch invoices", `${overdue.data?.length ?? 0} (${formatMoney(overdueTotal)})`],
  ];
  for (const to of recipients) {
    await sendEmailSafely({ to, template: "daily_operations_summary", data: { date: formatDate(today), lines, dashboardUrl: absoluteUrl("/dashboard") }, dedupeKey: `daily-summary:${today}:${to}` });
  }
  return { recipients: recipients.length };
}

/** Re-sends failed emails whose backoff has elapsed. */
export async function retryFailedNotifications(now: Date): Promise<JobResult> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("communications")
    .select("id")
    .eq("status", "failed")
    .eq("channel", "email")
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at")
    .limit(50);
  let sent = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const outcome = await retryCommunication(row.id);
    if (outcome === "sent") sent++;
    else if (outcome === "failed") failed++;
  }
  return { attempted: data?.length ?? 0, sent, failed };
}

export async function businessToday(now = new Date()): Promise<string> {
  const { timezone } = await getOperationsSettings();
  return localDate(now, timezone);
}

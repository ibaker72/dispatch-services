import "server-only";
import { formatDate } from "@/lib/domain/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { sendEmailSafely } from "@/lib/email/send";
import { absoluteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Billing notifications. Recipients are resolved with the service role after an authorized change succeeded. */
async function billingRecipients(carrierId: string) {
  const admin = createSupabaseAdminClient();
  const { data: carrier } = await admin.from("carriers").select("legal_name, email, organization_id").eq("id", carrierId).single();
  if (!carrier) return { carrierName: "", emails: [] as string[] };
  const { data: owners } = await admin
    .from("organization_members")
    .select("profiles!organization_members_user_id_fkey(email)")
    .eq("organization_id", carrier.organization_id)
    .eq("status", "active")
    .eq("role", "carrier_owner");
  const emails = (owners ?? []).map((o) => o.profiles?.email).filter((e): e is string => Boolean(e));
  return { carrierName: carrier.legal_name, emails: emails.length ? emails : carrier.email ? [carrier.email] : [] };
}

export async function notifyStatementIssued(statementId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: s } = await admin.from("weekly_statements").select("*").eq("id", statementId).single();
  if (!s || s.status !== "issued") return;
  const { carrierName, emails } = await billingRecipients(s.carrier_id);
  for (const to of emails) {
    await sendEmailSafely({
      to,
      template: "weekly_statement_ready",
      data: {
        carrierName,
        periodLabel: `${formatDate(s.period_start, { month: "short", day: "numeric" })} – ${formatDate(s.period_end)}`,
        completedLoads: s.loads_count,
        grossRevenue: formatMoney(s.gross_load_revenue),
        dispatchFee: formatMoney(s.dispatch_fee),
        amountDue: formatMoney(s.amount_due),
        statementUrl: absoluteUrl(`/portal/billing/statements/${s.id}`),
      },
      carrierId: s.carrier_id,
      visibility: "carrier",
      dedupeKey: `statement-issued:${s.id}:${to}`,
    });
  }
}

export async function notifyInvoiceDue(invoiceId: string, opts: { overdue: boolean; dedupeSuffix: string }): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv || inv.status !== "open") return 0;
  const { carrierName, emails } = await billingRecipients(inv.carrier_id);
  for (const to of emails) {
    await sendEmailSafely({
      to,
      template: "invoice_due",
      data: {
        carrierName,
        invoiceNumber: inv.invoice_number,
        amountDue: formatMoney(inv.balance_due),
        dueDate: formatDate(inv.due_date),
        overdue: opts.overdue,
        invoiceUrl: absoluteUrl(`/portal/billing/invoices/${inv.id}`),
      },
      carrierId: inv.carrier_id,
      visibility: "carrier",
      dedupeKey: `invoice-due:${inv.id}:${to}:${opts.dedupeSuffix}`,
    });
  }
  if (emails.length) await admin.from("invoices").update({ sent_at: new Date().toISOString() }).eq("id", inv.id);
  return emails.length;
}

export async function notifyPaymentReceived(paymentId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: p } = await admin.from("payments").select("*, invoices(invoice_number)").eq("id", paymentId).single();
  if (!p || p.status !== "succeeded") return;
  const { carrierName, emails } = await billingRecipients(p.carrier_id);
  for (const to of emails) {
    await sendEmailSafely({
      to,
      template: "payment_received",
      data: {
        carrierName,
        invoiceNumber: p.invoices?.invoice_number ?? "",
        amount: formatMoney(p.amount),
        method: PAYMENT_METHOD_LABELS[p.method],
        receivedOn: formatDate(p.received_at),
        invoiceUrl: absoluteUrl(`/portal/billing/invoices/${p.invoice_id}`),
      },
      carrierId: p.carrier_id,
      visibility: "carrier",
      dedupeKey: `payment-received:${p.id}:${to}`,
    });
  }
}

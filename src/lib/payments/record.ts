import "server-only";
import { trackServer } from "@/lib/analytics/server";
import { notifyPaymentReceived } from "@/lib/billing";
import { centsToDecimal } from "@/lib/domain/money";
import type { PaymentEvent } from "@/lib/payments";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type RecordOutcome = "recorded" | "updated" | "duplicate" | "ignored" | "rejected";

/**
 * Records a verified payment-provider event against a dispatch service
 * invoice. Idempotent: provider event, session and payment-intent ids are
 * unique in the payments table, so webhook retries never double count.
 * Only invoices belonging to the carrier named in the event are touched.
 */
export async function recordPaymentEvent(event: PaymentEvent): Promise<RecordOutcome> {
  if (event.kind === "ignored" || !event.invoiceId || !event.carrierId) return "ignored";
  const admin = createSupabaseAdminClient();

  const { data: invoice } = await admin.from("invoices").select("id, carrier_id, status").eq("id", event.invoiceId).maybeSingle();
  if (!invoice || invoice.carrier_id !== event.carrierId) {
    console.error("[payments] event references an unknown invoice or carrier mismatch", event.eventId);
    return "rejected";
  }

  const { data: duplicate } = await admin.from("payments").select("id").eq("stripe_event_id", event.eventId).maybeSingle();
  if (duplicate) return "duplicate";

  const status = event.kind === "paid" ? "succeeded" : event.kind === "failed" ? "failed" : "pending";
  const { data: existing } = event.sessionId
    ? await admin.from("payments").select("id, status").eq("stripe_checkout_session_id", event.sessionId).maybeSingle()
    : { data: null };

  if (existing) {
    if (existing.status === status || existing.status === "succeeded" || existing.status === "refunded") return "duplicate";
    const { error } = await admin.from("payments").update({ status }).eq("id", existing.id);
    if (error) throw new Error(`payment update failed: ${error.message}`);
    if (status === "succeeded") await afterSuccess(existing.id, event.carrierId);
    return "updated";
  }

  if (event.amountCents <= 0n) return "ignored";
  const { data: inserted, error } = await admin
    .from("payments")
    .insert({
      invoice_id: invoice.id,
      carrier_id: invoice.carrier_id,
      amount: Number(centsToDecimal(event.amountCents)),
      method: "stripe",
      status,
      stripe_event_id: event.eventId,
      stripe_checkout_session_id: event.sessionId,
      stripe_payment_intent_id: event.paymentIntentId,
      reference: event.paymentIntentId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`payment insert failed: ${error.message}`);
  }
  if (status === "succeeded") await afterSuccess(inserted.id, event.carrierId);
  return "recorded";
}

async function afterSuccess(paymentId: string, carrierId: string) {
  await notifyPaymentReceived(paymentId);
  await trackServer("invoice_paid", carrierId, { method: "online" });
}

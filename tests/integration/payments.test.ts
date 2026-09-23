/**
 * Payment recording is the only place money enters the ledger online, so it
 * must be idempotent, carrier-scoped and driven only by verified events.
 */
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpenInvoice } from "./support/fixtures";
import { closePool, getPool } from "../db/support/harness";
import { type World, createWorld } from "../db/support/world";
import { WebhookSignatureError, createStripeDriverForTests, payments, signMockPayload } from "@/lib/payments";
import { recordPaymentEvent } from "@/lib/payments/record";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

async function invoiceState(id: string) {
  const { rows } = await getPool().query<{ status: string; amount_paid: string; balance_due: string }>(
    `select status::text, amount_paid::text, balance_due::text from public.invoices where id = $1`,
    [id],
  );
  return rows[0]!;
}
const paymentCount = async (id: string) => Number((await getPool().query(`select count(*) from public.payments where invoice_id = $1`, [id])).rows[0].count);

describe("recordPaymentEvent", () => {
  it("records a verified payment once, even when the provider retries", async () => {
    const invoiceId = await createOpenInvoice(w.A, "329.00");
    const event = { kind: "paid" as const, eventId: `evt_${invoiceId}`, sessionId: `cs_${invoiceId}`, paymentIntentId: `pi_${invoiceId}`, invoiceId, carrierId: w.A.carrierId, amountCents: 32900n };
    expect(await recordPaymentEvent(event)).toBe("recorded");
    expect(await recordPaymentEvent(event)).toBe("duplicate");
    expect(await recordPaymentEvent({ ...event, eventId: `evt_retry_${invoiceId}` })).toBe("duplicate");
    expect(await paymentCount(invoiceId)).toBe(1);
    expect(await invoiceState(invoiceId)).toEqual({ status: "paid", amount_paid: "329.00", balance_due: "0.00" });
  });

  it("promotes a pending payment when the same checkout session succeeds", async () => {
    const invoiceId = await createOpenInvoice(w.A, "120.00");
    const base = { sessionId: `cs_p_${invoiceId}`, paymentIntentId: `pi_p_${invoiceId}`, invoiceId, carrierId: w.A.carrierId, amountCents: 12000n };
    expect(await recordPaymentEvent({ ...base, kind: "pending", eventId: `evt_p1_${invoiceId}` })).toBe("recorded");
    expect((await invoiceState(invoiceId)).status).toBe("open");
    expect(await recordPaymentEvent({ ...base, kind: "paid", eventId: `evt_p2_${invoiceId}` })).toBe("updated");
    expect((await invoiceState(invoiceId)).status).toBe("paid");
    expect(await paymentCount(invoiceId)).toBe(1);
  });

  it("rejects events whose carrier does not own the invoice", async () => {
    const invoiceId = await createOpenInvoice(w.A, "50.00");
    const outcome = await recordPaymentEvent({ kind: "paid", eventId: `evt_x_${invoiceId}`, sessionId: `cs_x_${invoiceId}`, paymentIntentId: null, invoiceId, carrierId: w.B.carrierId, amountCents: 5000n });
    expect(outcome).toBe("rejected");
    expect(await paymentCount(invoiceId)).toBe(0);
  });

  it("ignores events that are not for a dispatch-service invoice", async () => {
    expect(await recordPaymentEvent({ kind: "ignored", eventId: "evt_other", sessionId: null, paymentIntentId: null, invoiceId: null, carrierId: null, amountCents: 0n })).toBe("ignored");
  });
});

describe("webhook verification", () => {
  it("mock driver accepts only correctly signed payloads", async () => {
    const body = JSON.stringify({ eventId: "evt_1", sessionId: "cs_1", invoiceId: "00000000-0000-0000-0000-000000000000", carrierId: "00000000-0000-0000-0000-000000000000", amountCents: "100" });
    await expect(payments().parseWebhook(body, new Headers({ "x-mock-signature": "bad" }))).rejects.toBeInstanceOf(WebhookSignatureError);
    const event = await payments().parseWebhook(body, new Headers({ "x-mock-signature": signMockPayload(body) }));
    expect(event).toMatchObject({ kind: "paid", eventId: "evt_1", amountCents: 100n });
  });

  it("Stripe driver verifies signatures and only handles dispatch-service checkouts", async () => {
    const secret = "whsec_integration_test_secret";
    const driver = createStripeDriverForTests("sk_test_integration", secret);
    const stripe = new Stripe("sk_test_integration");
    const payload = (purpose: string) =>
      JSON.stringify({
        id: `evt_${purpose}`,
        object: "event",
        type: "checkout.session.completed",
        data: { object: { id: "cs_test_1", object: "checkout.session", payment_status: "paid", payment_intent: "pi_test_1", amount_total: 32900, metadata: { purpose, invoice_id: "inv-1", carrier_id: "car-1" } } },
      });
    const good = payload("dispatch_service_invoice");
    const header = stripe.webhooks.generateTestHeaderString({ payload: good, secret });
    expect(await driver.parseWebhook(good, new Headers({ "stripe-signature": header }))).toMatchObject({
      kind: "paid",
      invoiceId: "inv-1",
      carrierId: "car-1",
      sessionId: "cs_test_1",
      paymentIntentId: "pi_test_1",
      amountCents: 32900n,
    });
    await expect(driver.parseWebhook(good.replace("32900", "1"), new Headers({ "stripe-signature": header }))).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(driver.parseWebhook(good, new Headers())).rejects.toBeInstanceOf(WebhookSignatureError);
    const other = payload("freight_payment");
    expect((await driver.parseWebhook(other, new Headers({ "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: other, secret }) }))).kind).toBe("ignored");
  });
});

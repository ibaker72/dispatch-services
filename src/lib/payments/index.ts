import "server-only";
import { createHmac } from "node:crypto";
import Stripe from "stripe";
import { ConfigurationError, serverEnv } from "@/lib/env";
import { constantTimeEqual, randomToken } from "@/lib/security/tokens";
import { siteUrl } from "@/lib/site-url";

/**
 * Collects payment for the dispatch company's own service invoices from the
 * carrier. It never handles broker/shipper freight payments.
 *
 *  - stripe: Stripe Checkout Sessions + signed webhooks
 *  - mock:   development/E2E stand-in; events are HMAC-signed and delivered
 *            to the same webhook route (refused in production)
 *  - manual: no online payments; invoices show manual payment instructions
 */
export interface CheckoutRequest {
  invoiceId: string;
  invoiceNumber: string;
  carrierId: string;
  amountCents: bigint;
  customerEmail?: string | null;
  successPath: string;
  cancelPath: string;
}

export interface PaymentEvent {
  kind: "paid" | "failed" | "pending" | "ignored";
  eventId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  carrierId: string | null;
  amountCents: bigint;
}

export interface PaymentsDriver {
  readonly name: "stripe" | "mock" | "manual";
  readonly online: boolean;
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent>;
}

class StripeDriver implements PaymentsDriver {
  readonly name = "stripe" as const;
  readonly online = true;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckout(req: CheckoutRequest) {
    if (req.amountCents <= 0n || req.amountCents > 99_999_999n) throw new Error("invalid checkout amount");
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: req.invoiceId,
      customer_email: req.customerEmail ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Number(req.amountCents),
            product_data: { name: `Dispatch service invoice ${req.invoiceNumber}` },
          },
        },
      ],
      metadata: { invoice_id: req.invoiceId, carrier_id: req.carrierId, purpose: "dispatch_service_invoice" },
      payment_intent_data: {
        description: `Dispatch service invoice ${req.invoiceNumber}`,
        metadata: { invoice_id: req.invoiceId, carrier_id: req.carrierId },
      },
      success_url: `${siteUrl()}${req.successPath}`,
      cancel_url: `${siteUrl()}${req.cancelPath}`,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { id: session.id, url: session.url };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent> {
    const signature = headers.get("stripe-signature");
    if (!signature) throw new WebhookSignatureError();
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new WebhookSignatureError();
    }
    const base = { eventId: event.id, sessionId: null, paymentIntentId: null, invoiceId: null, carrierId: null, amountCents: 0n };
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.purpose !== "dispatch_service_invoice") return { ...base, kind: "ignored" };
      const paid = event.type === "checkout.session.async_payment_succeeded" || (event.type === "checkout.session.completed" && session.payment_status === "paid");
      return {
        kind: event.type === "checkout.session.async_payment_failed" ? "failed" : paid ? "paid" : "pending",
        eventId: event.id,
        sessionId: session.id,
        paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
        invoiceId: session.metadata?.invoice_id ?? null,
        carrierId: session.metadata?.carrier_id ?? null,
        amountCents: BigInt(session.amount_total ?? 0),
      };
    }
    return { ...base, kind: "ignored" };
  }
}

export class WebhookSignatureError extends Error {
  constructor() {
    super("invalid webhook signature");
    this.name = "WebhookSignatureError";
  }
}

function mockSecret(): string {
  return process.env.MOCK_PAYMENTS_SECRET ?? process.env.LOCAL_STORAGE_SIGNING_SECRET ?? "mock-payments-development-secret";
}

export function signMockPayload(body: string): string {
  return createHmac("sha256", mockSecret()).update(body).digest("hex");
}

class MockDriver implements PaymentsDriver {
  readonly name = "mock" as const;
  readonly online = true;

  async createCheckout(req: CheckoutRequest) {
    const id = `cs_mock_${randomToken(12)}`;
    const payload = JSON.stringify({
      id,
      invoiceId: req.invoiceId,
      carrierId: req.carrierId,
      amountCents: req.amountCents.toString(),
      invoiceNumber: req.invoiceNumber,
      successPath: req.successPath,
      cancelPath: req.cancelPath,
    });
    const token = Buffer.from(payload).toString("base64url");
    return { id, url: `${siteUrl()}/dev/mock-checkout?session=${token}&sig=${signMockPayload(token)}` };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent> {
    const signature = headers.get("x-mock-signature") ?? "";
    if (!constantTimeEqual(signMockPayload(rawBody), signature)) throw new WebhookSignatureError();
    const body = JSON.parse(rawBody) as { eventId: string; sessionId: string; invoiceId: string; carrierId: string; amountCents: string };
    return {
      kind: "paid",
      eventId: body.eventId,
      sessionId: body.sessionId,
      paymentIntentId: `pi_mock_${body.sessionId.slice(-12)}`,
      invoiceId: body.invoiceId,
      carrierId: body.carrierId,
      amountCents: BigInt(body.amountCents),
    };
  }
}

class ManualDriver implements PaymentsDriver {
  readonly name = "manual" as const;
  readonly online = false;
  async createCheckout(): Promise<{ id: string; url: string }> {
    throw new ConfigurationError("Online payments are not configured. Use the manual payment instructions on the invoice.");
  }
  async parseWebhook(): Promise<PaymentEvent> {
    throw new WebhookSignatureError();
  }
}

let driver: PaymentsDriver | undefined;

export function payments(): PaymentsDriver {
  if (driver) return driver;
  const env = serverEnv();
  if (env.paymentsDriver === "stripe") {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      throw new ConfigurationError("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required for Stripe payments");
    }
    driver = new StripeDriver(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  } else if (env.paymentsDriver === "mock") {
    driver = new MockDriver();
  } else {
    driver = new ManualDriver();
  }
  return driver;
}

/** Test hook: lets tests construct a Stripe driver with a known webhook secret. */
export function createStripeDriverForTests(secretKey: string, webhookSecret: string): PaymentsDriver {
  return new StripeDriver(secretKey, webhookSecret);
}

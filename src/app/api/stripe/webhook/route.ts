import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { WebhookSignatureError, payments } from "@/lib/payments";
import { recordPaymentEvent } from "@/lib/payments/record";

/**
 * Stripe webhook (checkout.session.completed / async_payment_succeeded /
 * async_payment_failed). The raw body is verified with STRIPE_WEBHOOK_SECRET
 * before anything is read; unknown events are acknowledged and ignored.
 */
export async function POST(request: NextRequest) {
  if (serverEnv().paymentsDriver !== "stripe") return new NextResponse("Not found", { status: 404 });
  const raw = await request.text();
  try {
    const event = await payments().parseWebhook(raw, request.headers);
    const outcome = await recordPaymentEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    if (error instanceof WebhookSignatureError) return new NextResponse("Invalid signature", { status: 400 });
    Sentry.captureException(error);
    console.error("[stripe webhook] processing failed", error instanceof Error ? error.message : error);
    // 500 makes Stripe retry; recording is idempotent.
    return new NextResponse("Processing failed", { status: 500 });
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { WebhookSignatureError, payments } from "@/lib/payments";
import { recordPaymentEvent } from "@/lib/payments/record";

/**
 * Webhook endpoint for the development/E2E mock payment driver. Events must
 * carry a valid HMAC signature. Disabled unless PAYMENTS_DRIVER=mock (which
 * the environment validator refuses in production).
 */
export async function POST(request: NextRequest) {
  if (serverEnv().paymentsDriver !== "mock") return new NextResponse("Not found", { status: 404 });
  const raw = await request.text();
  try {
    const event = await payments().parseWebhook(raw, request.headers);
    return NextResponse.json({ received: true, outcome: await recordPaymentEvent(event) });
  } catch (error) {
    if (error instanceof WebhookSignatureError) return new NextResponse("Invalid signature", { status: 400 });
    console.error("[mock webhook] processing failed", error instanceof Error ? error.message : error);
    return new NextResponse("Processing failed", { status: 500 });
  }
}

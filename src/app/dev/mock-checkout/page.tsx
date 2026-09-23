import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { centsToDecimal, formatMoney } from "@/lib/domain/money";
import { serverEnv } from "@/lib/env";
import { signMockPayload } from "@/lib/payments";
import { constantTimeEqual, randomToken } from "@/lib/security/tokens";
import { siteUrl } from "@/lib/site-url";

export const metadata = { title: "Test checkout", robots: { index: false, follow: false } };

interface MockSession {
  id: string;
  invoiceId: string;
  carrierId: string;
  amountCents: string;
  invoiceNumber: string;
  successPath: string;
  cancelPath: string;
}

function decode(session: string | undefined, sig: string | undefined): MockSession | null {
  if (!session || !sig || !constantTimeEqual(signMockPayload(session), sig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(session, "base64url").toString("utf8")) as MockSession;
    if (!parsed.successPath.startsWith("/") || parsed.successPath.startsWith("//")) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Development/E2E stand-in for Stripe Checkout (PAYMENTS_DRIVER=mock only).
 * "Pay" delivers a signed event to the mock webhook, exercising the same
 * idempotent recording path as real Stripe events.
 */
export default async function MockCheckoutPage({ searchParams }: { searchParams: Promise<{ session?: string; sig?: string }> }) {
  if (serverEnv().paymentsDriver !== "mock") notFound();
  const { session, sig } = await searchParams;
  const data = decode(session, sig);
  if (!data) notFound();

  async function pay() {
    "use server";
    if (serverEnv().paymentsDriver !== "mock") notFound();
    const body = JSON.stringify({ eventId: `evt_mock_${randomToken(12)}`, sessionId: data!.id, invoiceId: data!.invoiceId, carrierId: data!.carrierId, amountCents: data!.amountCents });
    const res = await fetch(`${siteUrl()}/api/payments/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-mock-signature": signMockPayload(body) }, body });
    if (!res.ok) throw new Error("mock webhook failed");
    redirect(data!.successPath);
  }
  async function cancel() {
    "use server";
    redirect(data!.cancelPath);
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader>
          <h1 className="text-base font-semibold text-navy-900">Test checkout</h1>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="rounded-md bg-warning-soft p-3 text-sm text-warning">Development payment simulator. No money moves. Real deployments use Stripe Checkout.</p>
          <p className="text-sm">
            Dispatch service invoice <span className="font-semibold">{data.invoiceNumber}</span>
          </p>
          <p className="text-3xl font-semibold">{formatMoney(centsToDecimal(BigInt(data.amountCents)))}</p>
          <div className="flex gap-2">
            <form action={pay}>
              <Button type="submit">Pay (test)</Button>
            </form>
            <form action={cancel}>
              <Button type="submit" variant="secondary">
                Cancel
              </Button>
            </form>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { payInvoice } from "../../../actions";
import { InvoiceView } from "@/components/billing/invoice-view";
import { ActionForm } from "@/components/action-form";
import { Alert } from "@/components/ui/alert";
import { CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { business } from "@/config/business";
import { requireCarrierUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/query";
import { formatMoney } from "@/lib/domain/money";
import { payments } from "@/lib/payments";
import { getBusinessProfile, getFeatureFlag } from "@/lib/settings";

export const metadata = { title: "Invoice" };

export default async function PortalInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { id } = await params;
  const { payment } = await searchParams;
  if (!isUuid(id)) notFound();
  const ctx = await requireCarrierUser();
  const { data: invoice } = await ctx.supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice) notFound();
  const [lines, paid, carrier, profile, onlineEnabled] = await Promise.all([
    ctx.supabase.from("invoice_line_items").select("*").eq("invoice_id", id).order("created_at"),
    ctx.supabase.from("payments").select("id, amount, method, status, reference, received_at").eq("invoice_id", id).order("received_at"),
    ctx.supabase.from("carriers").select("legal_name, address_line1, city, state, postal_code").eq("id", invoice.carrier_id).single(),
    getBusinessProfile(),
    getFeatureFlag("online_invoice_payments"),
  ]);
  let online = false;
  try {
    online = onlineEnabled && payments().online;
  } catch {
    online = false;
  }
  const owner = ctx.membership.role === "carrier_owner";
  const manual = business.manualPayment;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/portal/billing" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Statements and invoices
          </Link>
        }
        title={`Invoice ${invoice.invoice_number}`}
      />
      {payment === "success" ? (
        <Alert tone="success" title="Thank you" className="mb-6" live>
          Your payment was submitted. It can take a moment to appear here; we will email a receipt when it is recorded.
        </Alert>
      ) : payment === "cancelled" ? (
        <Alert tone="info" className="mb-6">
          Payment was cancelled. Nothing was charged.
        </Alert>
      ) : null}
      <InvoiceView
        invoice={invoice}
        lines={lines.data ?? []}
        payments={paid.data ?? []}
        billedBy={{ name: profile.legalEntity, lines: [profile.address, profile.email].filter(Boolean) }}
        billTo={{
          name: carrier.data?.legal_name ?? "",
          lines: [carrier.data?.address_line1, [carrier.data?.city, carrier.data?.state, carrier.data?.postal_code].filter(Boolean).join(" ")].filter((v): v is string => Boolean(v)),
        }}
        aside={
          invoice.status === "open" && Number(invoice.balance_due) > 0 ? (
            <CardBody className="space-y-3 border-t border-steel-200">
              {online && owner ? (
                <ActionForm action={payInvoice} submitLabel={`Pay ${formatMoney(invoice.balance_due)} online`} pendingLabel="Opening secure checkout…" inline>
                  <input type="hidden" name="invoice_id" value={invoice.id} />
                </ActionForm>
              ) : null}
              {online && !owner ? <p className="text-sm text-steel-600">Your company owner can pay this invoice online.</p> : null}
              <div className="text-sm text-steel-700">
                <p className="font-semibold">Other ways to pay</p>
                {manual.achInstructions || manual.checkPayableTo ? (
                  <>
                    {manual.achInstructions ? <p>ACH: {manual.achInstructions}</p> : null}
                    {manual.checkPayableTo ? (
                      <p>
                        Check payable to {manual.checkPayableTo}
                        {manual.mailingAddress ? `, mailed to ${manual.mailingAddress}` : ""}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p>Contact your dispatcher for ACH or check instructions. Include invoice {invoice.invoice_number} with your payment.</p>
                )}
              </div>
            </CardBody>
          ) : null
        }
      />
    </>
  );
}

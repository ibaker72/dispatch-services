import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { recordManualPayment, sendInvoiceReminder, setInvoiceStatus } from "../../actions";
import { InvoiceView } from "@/components/billing/invoice-view";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { isAdminRole, requireStaff } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/query";
import { formatDateTime, localDate } from "@/lib/domain/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/domain/labels";
import { getBusinessProfile, getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireStaff();
  const admin = isAdminRole(ctx.staffRoles);
  const { data: invoice } = await ctx.supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice) notFound();
  const [lines, payments, carrier, profile, ops] = await Promise.all([
    ctx.supabase.from("invoice_line_items").select("*").eq("invoice_id", id).order("created_at"),
    ctx.supabase.from("payments").select("id, amount, method, status, reference, received_at").eq("invoice_id", id).order("received_at"),
    ctx.supabase.from("carriers").select("legal_name, address_line1, city, state, postal_code, email").eq("id", invoice.carrier_id).single(),
    getBusinessProfile(),
    getOperationsSettings(),
  ]);
  const today = localDate(new Date(), ops.timezone);
  const overdue = invoice.status === "open" && invoice.due_date !== null && invoice.due_date < today;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/billing?tab=invoices" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Invoices
          </Link>
        }
        title={`Invoice ${invoice.invoice_number}`}
        description={
          <Link href={`/dashboard/carriers/${invoice.carrier_id}?tab=billing`} className="hover:underline">
            {carrier.data?.legal_name}
          </Link>
        }
      />
      {overdue ? (
        <Alert tone="warning" title="Overdue" className="mb-6">
          This invoice is past its due date.
        </Alert>
      ) : null}
      {invoice.status === "void" ? (
        <Alert tone="danger" title="Void" className="mb-6">
          {invoice.void_reason}
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <InvoiceView
          invoice={invoice}
          lines={lines.data ?? []}
          payments={payments.data ?? []}
          billedBy={{ name: profile.legalEntity, lines: [profile.address, profile.email].filter(Boolean) }}
          billTo={{
            name: carrier.data?.legal_name ?? "",
            lines: [carrier.data?.address_line1, [carrier.data?.city, carrier.data?.state, carrier.data?.postal_code].filter(Boolean).join(" "), carrier.data?.email].filter(
              (v): v is string => Boolean(v),
            ),
          }}
        />
        <aside className="space-y-6">
          {invoice.status === "open" ? (
            <Card>
              <CardHeader>
                <CardTitle>Collect</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <p className="text-sm text-steel-700">
                  The carrier can pay online from the portal. Record payments received by ACH, check, wire or Zelle here.
                </p>
                {invoice.sent_at ? <p className="text-xs text-steel-600">Last emailed {formatDateTime(invoice.sent_at, ops.timezone)}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={sendInvoiceReminder} submitLabel="Email invoice" submitVariant="secondary" submitSize="sm" inline>
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                  </ActionForm>
                  {admin ? (
                    <FormDialog title="Record a payment" description="Only for money actually received. Online card/ACH payments are recorded automatically from Stripe." triggerLabel="Record payment" triggerSize="sm">
                      <ActionForm action={recordManualPayment} submitLabel="Record payment">
                        <input type="hidden" name="invoice_id" value={invoice.id} />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <FormField id="p-amount" name="amount" label="Amount ($)" required>
                            <Input name="amount" inputMode="decimal" defaultValue={Number(invoice.balance_due ?? 0).toFixed(2)} />
                          </FormField>
                          <FormField id="p-method" name="method" label="Method" required>
                            <Select name="method" defaultValue="ach">
                              {(["ach", "check", "wire", "zelle", "other"] as const).map((m) => (
                                <option key={m} value={m}>
                                  {PAYMENT_METHOD_LABELS[m]}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                          <FormField id="p-ref" name="reference" label="Reference / check #">
                            <Input name="reference" maxLength={100} />
                          </FormField>
                          <FormField id="p-date" name="received_on" label="Received on">
                            <Input name="received_on" type="date" defaultValue={today} />
                          </FormField>
                        </div>
                        <FormField id="p-notes" name="notes" label="Notes">
                          <Textarea name="notes" rows={2} maxLength={1000} />
                        </FormField>
                      </ActionForm>
                    </FormDialog>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ) : null}
          {admin && (invoice.status === "open" || invoice.status === "uncollectible") ? (
            <Card>
              <CardHeader>
                <CardTitle>Other actions</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-wrap gap-2">
                {invoice.status === "open" ? (
                  <ActionForm action={setInvoiceStatus} submitLabel="Mark uncollectible" submitVariant="ghost" submitSize="sm" inline>
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <input type="hidden" name="status" value="uncollectible" />
                  </ActionForm>
                ) : (
                  <ActionForm action={setInvoiceStatus} submitLabel="Reopen" submitVariant="ghost" submitSize="sm" inline>
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <input type="hidden" name="status" value="open" />
                  </ActionForm>
                )}
                {Number(invoice.amount_paid) === 0 ? (
                  <ConfirmAction action={setInvoiceStatus} title="Void invoice" description="Voided invoices remain on record and cannot be reopened." triggerLabel="Void" triggerVariant="ghost" confirmLabel="Void invoice">
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <input type="hidden" name="status" value="void" />
                    <FormField id="inv-void-reason" name="void_reason" label="Reason" required>
                      <Textarea name="void_reason" rows={2} maxLength={1000} />
                    </FormField>
                  </ConfirmAction>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
          {invoice.statement_id ? (
            <Link href={`/dashboard/billing/statements/${invoice.statement_id}`} className="block text-sm font-semibold underline">
              View weekly statement
            </Link>
          ) : null}
        </aside>
      </div>
    </>
  );
}

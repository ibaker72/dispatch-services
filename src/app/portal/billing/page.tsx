import { InvoicesTable, type InvoiceRow, StatementsTable, type StatementRow } from "@/components/billing/tables";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { localDate } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Statements and invoices" };

export default async function PortalBillingPage() {
  const ctx = await requireCarrierUser();
  const { timezone } = await getOperationsSettings();
  // RLS shows carriers only issued statements and invoices (never drafts).
  const [statements, invoices] = await Promise.all([
    ctx.supabase
      .from("weekly_statements")
      .select("id, period_start, period_end, status, loads_count, gross_load_revenue, dispatch_fee, credits_adjustments, amount_due, invoices!weekly_statements_invoice_fk(id, invoice_number, status)")
      .order("period_start", { ascending: false })
      .limit(52),
    ctx.supabase.from("invoices").select("id, invoice_number, status, issue_date, due_date, total, amount_paid, balance_due").order("created_at", { ascending: false }).limit(52),
  ]);
  return (
    <>
      <PageHeader
        title="Statements and invoices"
        description="Each week we send a statement of completed loads and the dispatch fee under your agreement. Freight payments go from brokers to you — we never collect them."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          {(invoices.data ?? []).length ? (
            <InvoicesTable rows={invoices.data as InvoiceRow[]} basePath="/portal/billing/invoices" today={localDate(new Date(), timezone)} />
          ) : (
            <CardBody className="text-sm text-steel-600">No invoices yet.</CardBody>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Weekly statements</CardTitle>
          </CardHeader>
          {(statements.data ?? []).length ? (
            <StatementsTable rows={statements.data as unknown as StatementRow[]} basePath="/portal/billing/statements" />
          ) : (
            <CardBody className="text-sm text-steel-600">No statements yet.</CardBody>
          )}
        </Card>
      </div>
    </>
  );
}

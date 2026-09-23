import type { CarrierTabProps } from "./types";
import { InvoicesTable, type InvoiceRow, StatementsTable, type StatementRow } from "@/components/billing/tables";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { localDate } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export async function BillingTab({ ctx, carrier }: CarrierTabProps) {
  const { timezone } = await getOperationsSettings();
  const [statements, invoices] = await Promise.all([
    ctx.supabase
      .from("weekly_statements")
      .select("id, period_start, period_end, status, loads_count, gross_load_revenue, dispatch_fee, credits_adjustments, amount_due, invoices!weekly_statements_invoice_fk(id, invoice_number, status)")
      .eq("carrier_id", carrier.id)
      .order("period_start", { ascending: false })
      .limit(26),
    ctx.supabase
      .from("invoices")
      .select("id, invoice_number, status, issue_date, due_date, total, amount_paid, balance_due")
      .eq("carrier_id", carrier.id)
      .order("created_at", { ascending: false })
      .limit(26),
  ]);
  return (
    <div className="space-y-6">
      <p className="text-sm text-steel-600">
        Carrier gross is the carrier&apos;s freight revenue, paid by brokers directly to the carrier or its factoring company. Only the dispatch fee is invoiced here.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Weekly statements</CardTitle>
        </CardHeader>
        {(statements.data ?? []).length ? (
          <StatementsTable rows={statements.data as unknown as StatementRow[]} basePath="/dashboard/billing/statements" />
        ) : (
          <CardBody className="text-sm text-steel-600">No statements yet.</CardBody>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        {(invoices.data ?? []).length ? (
          <InvoicesTable rows={invoices.data as InvoiceRow[]} basePath="/dashboard/billing/invoices" today={localDate(new Date(), timezone)} />
        ) : (
          <CardBody className="text-sm text-steel-600">No invoices yet.</CardBody>
        )}
      </Card>
    </div>
  );
}

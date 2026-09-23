import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addStatementCredit, issueStatement, regenerateStatement, removeStatementLine, voidStatement } from "../../actions";
import { StatementView } from "@/components/billing/statement-view";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { isAdminRole, requireStaff } from "@/lib/auth/session";
import { isUuid } from "@/lib/db/query";
import { formatDate } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Statement" };

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireStaff();
  const admin = isAdminRole(ctx.staffRoles);
  const { data: s } = await ctx.supabase
    .from("weekly_statements")
    .select("*, carriers(legal_name), invoices!weekly_statements_invoice_fk(id, invoice_number, status)")
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();
  const { data: lines } = await ctx.supabase.from("statement_line_items").select("*").eq("statement_id", id).eq("voided", false).order("created_at");
  const ops = await getOperationsSettings();

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/dashboard/billing?week=${s.period_start}`} className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Billing
          </Link>
        }
        title={`Statement: ${s.carriers?.legal_name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} />
            Week of {formatDate(s.period_start)} – {formatDate(s.period_end)}
          </span>
        }
        actions={
          <Link href={`/dashboard/carriers/${s.carrier_id}?tab=billing`} className="inline-flex h-10 items-center rounded-md border border-steel-300 bg-white px-4 text-sm font-semibold hover:bg-paper-2">
            Carrier billing
          </Link>
        }
      />
      {s.status === "void" ? (
        <Alert tone="danger" title="Void" className="mb-6">
          {s.void_reason}
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <StatementView
          statement={s}
          lines={lines ?? []}
          lineAction={
            admin && s.status === "draft"
              ? (line) =>
                  line.line_type === "credit" || line.line_type === "adjustment" ? (
                    <ActionForm action={removeStatementLine} submitLabel="Remove" submitVariant="ghost" submitSize="sm" inline>
                      <input type="hidden" name="line_id" value={line.id} />
                    </ActionForm>
                  ) : null
              : undefined
          }
        />
        <aside className="space-y-6">
          {admin && s.status === "draft" ? (
            <Card>
              <CardHeader>
                <CardTitle>Review and issue</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="text-sm text-steel-700">Check each load fee against the carrier&apos;s terms. Issuing locks the statement and creates the invoice.</p>
                <ActionForm action={issueStatement} submitLabel="Issue statement" pendingLabel="Issuing…">
                  <input type="hidden" name="statement_id" value={s.id} />
                  <FormField id="due_days" name="due_days" label="Invoice due in (days)">
                    <Input name="due_days" type="number" min={0} max={60} defaultValue={ops.statement_due_days} />
                  </FormField>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox name="notify" defaultChecked />
                    <span>Email the carrier that the statement is ready</span>
                  </label>
                </ActionForm>
                <div className="flex flex-wrap gap-2 border-t border-steel-200 pt-4">
                  <FormDialog title="Add credit or adjustment" triggerLabel="Add credit / adjustment" triggerVariant="secondary" triggerSize="sm">
                    <ActionForm action={addStatementCredit} submitLabel="Add line">
                      <input type="hidden" name="statement_id" value={s.id} />
                      <FormField id="kind" name="kind" label="Type">
                        <Select name="kind" defaultValue="credit">
                          <option value="credit">Credit (reduces amount due)</option>
                          <option value="adjustment_charge">Adjustment (adds to amount due)</option>
                        </Select>
                      </FormField>
                      <FormField id="credit-amount" name="amount" label="Amount ($)" required>
                        <Input name="amount" inputMode="decimal" />
                      </FormField>
                      <FormField id="credit-desc" name="description" label="Description" required hint="Shown to the carrier on the statement.">
                        <Input name="description" maxLength={300} />
                      </FormField>
                    </ActionForm>
                  </FormDialog>
                  <ActionForm action={regenerateStatement} submitLabel="Recalculate" submitVariant="ghost" submitSize="sm" inline>
                    <input type="hidden" name="carrier_id" value={s.carrier_id} />
                    <input type="hidden" name="period_start" value={s.period_start} />
                  </ActionForm>
                </div>
              </CardBody>
            </Card>
          ) : null}
          {s.invoices ? (
            <Card>
              <CardHeader>
                <CardTitle>Invoice</CardTitle>
              </CardHeader>
              <CardBody className="text-sm">
                <Link href={`/dashboard/billing/invoices/${s.invoices.id}`} className="font-semibold underline">
                  {s.invoices.invoice_number}
                </Link>{" "}
                <StatusBadge status={s.invoices.status} />
              </CardBody>
            </Card>
          ) : s.status === "issued" ? (
            <p className="text-sm text-steel-600">No invoice was needed: nothing was due for this week.</p>
          ) : null}
          {admin && s.status !== "void" ? (
            <ConfirmAction
              action={voidStatement}
              title="Void statement"
              description="Voided statements stay on record. Void the related invoice first if one exists, then regenerate the week."
              triggerLabel="Void statement"
              triggerVariant="ghost"
              confirmLabel="Void statement"
            >
              <input type="hidden" name="statement_id" value={s.id} />
              <FormField id="void_reason" name="void_reason" label="Reason" required>
                <Textarea name="void_reason" rows={2} maxLength={1000} />
              </FormField>
            </ConfirmAction>
          ) : null}
        </aside>
      </div>
    </>
  );
}

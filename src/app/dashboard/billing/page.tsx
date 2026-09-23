import { Download, Receipt } from "lucide-react";
import { createManualInvoice, generateStatements } from "./actions";
import { ActionForm, FormDialog, FormField } from "@/components/action-form";
import { InvoicesTable, type InvoiceRow, StatementsTable, type StatementRow } from "@/components/billing/tables";
import { FilterTabs, Pagination } from "@/components/dashboard/filters";
import { TabNav } from "@/components/dashboard/tab-nav";
import { WeekNav } from "@/components/dashboard/week-nav";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { isAdminRole, requireStaff } from "@/lib/auth/session";
import { PAGE_SIZE, type RawSearchParams, flatParams, pageParam, pageRange } from "@/lib/db/query";
import { addDays, formatDate, localDate, parseWeek, weekStart } from "@/lib/domain/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/domain/labels";
import { centsToDecimal, formatMoney, sumCents, toCents } from "@/lib/domain/money";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Billing" };

const INVOICE_VIEWS = { open: "Open", overdue: "Overdue", paid: "Paid", uncollectible: "Uncollectible", void: "Void", all: "All" } as const;

export default async function BillingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const admin = isAdminRole(ctx.staffRoles);
  const params = flatParams(await searchParams);
  const tab = params.tab === "invoices" ? "invoices" : params.tab === "payments" ? "payments" : "statements";
  const { timezone } = await getOperationsSettings();
  const today = localDate(new Date(), timezone);
  const current = weekStart(new Date(), timezone);
  const week = parseWeek(params.week, addDays(current, -7));

  const header = (
    <PageHeader
      title="Billing"
      description="Weekly statements and dispatch service invoices. We invoice carriers only for our dispatch fee; freight is paid by brokers directly to carriers or their factoring companies."
    />
  );
  const tabs = (
    <TabNav
      label="Billing sections"
      current={tab}
      tabs={[
        { key: "statements", label: "Weekly statements", href: "/dashboard/billing" },
        { key: "invoices", label: "Invoices", href: "/dashboard/billing?tab=invoices" },
        { key: "payments", label: "Payments", href: "/dashboard/billing?tab=payments" },
      ]}
    />
  );

  if (tab === "statements") {
    const { data } = await ctx.supabase
      .from("weekly_statements")
      .select("id, period_start, period_end, status, loads_count, gross_load_revenue, dispatch_fee, credits_adjustments, amount_due, carriers(legal_name), invoices!weekly_statements_invoice_fk(id, invoice_number, status)")
      .eq("period_start", week)
      .neq("status", "void")
      .order("created_at");
    const rows = (data ?? []) as unknown as StatementRow[];
    const drafts = rows.filter((r) => r.status === "draft").length;
    return (
      <>
        {header}
        {tabs}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <WeekNav base="/dashboard/billing" week={week} current={current} />
          {admin && week <= today ? (
            <ActionForm action={generateStatements} submitLabel={rows.length ? "Refresh draft statements" : "Generate statements"} pendingLabel="Generating…" inline>
              <input type="hidden" name="week" value={week} />
            </ActionForm>
          ) : null}
        </div>
        {rows.length ? (
          <>
            <div className="mb-4 grid gap-4 sm:grid-cols-3">
              <Stat label="Carrier gross (completed loads)" value={formatMoney(centsToDecimal(sumCents(rows.map((r) => toCents(r.gross_load_revenue)))))} tone="carrier" />
              <Stat label="Dispatch fees" value={formatMoney(centsToDecimal(sumCents(rows.map((r) => toCents(r.dispatch_fee)))))} tone="company" />
              <Stat label="Drafts to review" value={drafts} tone={drafts ? "warning" : "default"} />
            </div>
            <Card>
              <StatementsTable rows={rows} basePath="/dashboard/billing/statements" showCarrier />
            </Card>
          </>
        ) : (
          <EmptyState icon={Receipt} title="No statements for this week">
            {admin ? "Generate statements to calculate dispatch fees from completed loads and flat weekly plans." : "An administrator generates statements each week."}
          </EmptyState>
        )}
      </>
    );
  }

  if (tab === "payments") {
    const page = pageParam(params.page);
    const [from, to] = pageRange(page);
    const { data, count } = await ctx.supabase
      .from("payments")
      .select("id, amount, method, status, reference, received_at, invoice_id, invoices(invoice_number, carriers(legal_name))", { count: "exact" })
      .order("received_at", { ascending: false })
      .range(from, to);
    return (
      <>
        {header}
        {tabs}
        {data && data.length ? (
          <Card>
            <Table caption="Payments">
              <THead>
                <tr>
                  <TH>Received</TH>
                  <TH>Carrier</TH>
                  <TH>Invoice</TH>
                  <TH>Method</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {data.map((p) => (
                  <TR key={p.id}>
                    <TD>{formatDate(p.received_at)}</TD>
                    <TD>{p.invoices?.carriers?.legal_name}</TD>
                    <TD>
                      <a href={`/dashboard/billing/invoices/${p.invoice_id}`} className="hover:underline">
                        {p.invoices?.invoice_number}
                      </a>
                    </TD>
                    <TD>
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? <div className="text-xs text-steel-600">Ref {p.reference}</div> : null}
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(p.amount)}</TD>
                    <TD>{p.status}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <EmptyState icon={Receipt} title="No payments recorded yet" />
        )}
        <Pagination base="/dashboard/billing" params={{ tab: "payments" }} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
      </>
    );
  }

  const view = (params.view && params.view in INVOICE_VIEWS ? params.view : "open") as keyof typeof INVOICE_VIEWS;
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);
  let query = ctx.supabase
    .from("invoices")
    .select("id, invoice_number, status, issue_date, due_date, total, amount_paid, balance_due, carriers(legal_name)", { count: "exact" })
    .neq("status", "draft")
    .order("due_date", { ascending: view === "open" || view === "overdue" });
  if (view === "overdue") query = query.eq("status", "open").lt("due_date", today);
  else if (view !== "all") query = query.eq("status", view);
  const [{ data, count }, carriers, outstanding] = await Promise.all([
    query.range(from, to),
    admin ? ctx.supabase.from("carriers").select("id, legal_name").not("activated_at", "is", null).order("legal_name") : Promise.resolve({ data: [] }),
    ctx.supabase.from("invoices").select("balance_due, due_date").eq("status", "open"),
  ]);
  const open = outstanding.data ?? [];
  const overdue = open.filter((i) => i.due_date && i.due_date < today);

  return (
    <>
      {header}
      {tabs}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Outstanding" value={formatMoney(centsToDecimal(sumCents(open.map((i) => toCents(i.balance_due)))))} tone="company" hint={`${open.length} open invoices`} />
        <Stat label="Overdue" value={formatMoney(centsToDecimal(sumCents(overdue.map((i) => toCents(i.balance_due)))))} tone={overdue.length ? "warning" : "default"} hint={`${overdue.length} invoices`} />
        <div className="flex items-center justify-end gap-2">
          {/* A plain link: the export is a file download from a route handler, not a page. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/exports/invoices" className="inline-flex h-10 items-center gap-1.5 rounded-md border border-steel-300 bg-white px-3 text-sm font-semibold text-navy-900 hover:bg-paper-2">
            <Download className="size-4" aria-hidden="true" /> CSV
          </a>
          {admin ? (
            <FormDialog title="New manual invoice" description="For one-off dispatch service charges agreed with the carrier. Weekly fees are invoiced from statements." triggerLabel="Manual invoice" triggerVariant="secondary">
              <ActionForm action={createManualInvoice} submitLabel="Create and open invoice">
                <FormField id="mi-carrier" name="carrier_id" label="Carrier" required>
                  <Select name="carrier_id" defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {(carriers.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legal_name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="mi-desc" name="description" label="Line description" required>
                  <Input name="description" maxLength={300} placeholder="Dispatch services — adjustment for week of …" />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField id="mi-amount" name="amount" label="Amount ($)" required>
                    <Input name="amount" inputMode="decimal" />
                  </FormField>
                  <FormField id="mi-due" name="due_date" label="Due date" hint="Defaults to 7 days.">
                    <Input name="due_date" type="date" />
                  </FormField>
                </div>
                <FormField id="mi-memo" name="memo" label="Memo">
                  <Textarea name="memo" rows={2} maxLength={1000} />
                </FormField>
              </ActionForm>
            </FormDialog>
          ) : null}
        </div>
      </div>
      <FilterTabs
        base="/dashboard/billing"
        params={{ tab: "invoices", view: view === "open" ? undefined : view }}
        name="view"
        label="Invoice status"
        options={Object.entries(INVOICE_VIEWS).map(([k, label]) => ({ value: k === "open" ? undefined : k, label }))}
      />
      {data && data.length ? (
        <Card>
          <InvoicesTable rows={data as InvoiceRow[]} basePath="/dashboard/billing/invoices" showCarrier today={today} />
        </Card>
      ) : (
        <EmptyState icon={Receipt} title="No invoices in this view" />
      )}
      <Pagination base="/dashboard/billing" params={{ tab: "invoices", view: view === "open" ? undefined : view }} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}

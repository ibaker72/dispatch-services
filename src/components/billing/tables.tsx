import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";

export interface StatementRow {
  id: string;
  period_start: string;
  period_end: string | null;
  status: string;
  loads_count: number;
  gross_load_revenue: number;
  dispatch_fee: number;
  credits_adjustments: number;
  amount_due: number;
  carriers?: { legal_name: string } | null;
  invoices?: { id: string; invoice_number: string; status: string } | null;
}

export function StatementsTable({ rows, basePath, showCarrier = false }: { rows: StatementRow[]; basePath: string; showCarrier?: boolean }) {
  return (
    <Table caption="Weekly statements">
      <THead>
        <tr>
          <TH>Week</TH>
          {showCarrier ? <TH>Carrier</TH> : null}
          <TH className="text-right">Loads</TH>
          <TH className="text-right">Carrier gross</TH>
          <TH className="text-right">Dispatch fee</TH>
          <TH className="text-right">Amount due</TH>
          <TH>Status</TH>
        </tr>
      </THead>
      <tbody>
        {rows.map((s) => (
          <TR key={s.id}>
            <TD>
              <Link href={`${basePath}/${s.id}`} className="font-semibold text-navy-900 underline-offset-2 hover:underline">
                {formatDate(s.period_start, { month: "short", day: "numeric" })} – {formatDate(s.period_end)}
              </Link>
            </TD>
            {showCarrier ? <TD>{s.carriers?.legal_name}</TD> : null}
            <TD className="text-right tabular-nums">{s.loads_count}</TD>
            <TD className="text-right tabular-nums">{formatMoney(s.gross_load_revenue)}</TD>
            <TD className="text-right tabular-nums">{formatMoney(s.dispatch_fee)}</TD>
            <TD className="text-right font-semibold tabular-nums">{formatMoney(s.amount_due)}</TD>
            <TD>
              <StatusBadge status={s.status} />
              {s.invoices ? <div className="mt-1 text-xs text-steel-600">Invoice {s.invoices.invoice_number}</div> : null}
            </TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  total: number;
  amount_paid: number;
  balance_due: number | null;
  carriers?: { legal_name: string } | null;
}

export function InvoicesTable({ rows, basePath, showCarrier = false, today }: { rows: InvoiceRow[]; basePath: string; showCarrier?: boolean; today: string }) {
  return (
    <Table caption="Dispatch service invoices">
      <THead>
        <tr>
          <TH>Invoice</TH>
          {showCarrier ? <TH>Carrier</TH> : null}
          <TH>Issued</TH>
          <TH>Due</TH>
          <TH className="text-right">Total</TH>
          <TH className="text-right">Balance</TH>
          <TH>Status</TH>
        </tr>
      </THead>
      <tbody>
        {rows.map((i) => {
          const overdue = i.status === "open" && i.due_date !== null && i.due_date < today;
          return (
            <TR key={i.id}>
              <TD>
                <Link href={`${basePath}/${i.id}`} className="font-semibold text-navy-900 underline-offset-2 hover:underline">
                  {i.invoice_number}
                </Link>
              </TD>
              {showCarrier ? <TD>{i.carriers?.legal_name}</TD> : null}
              <TD>{formatDate(i.issue_date)}</TD>
              <TD className={overdue ? "font-semibold text-danger" : undefined}>
                {formatDate(i.due_date)}
                {overdue ? <span className="block text-xs">Overdue</span> : null}
              </TD>
              <TD className="text-right tabular-nums">{formatMoney(i.total)}</TD>
              <TD className="text-right font-semibold tabular-nums">{formatMoney(i.balance_due ?? 0)}</TD>
              <TD>
                <StatusBadge status={i.status} />
              </TD>
            </TR>
          );
        })}
      </tbody>
    </Table>
  );
}

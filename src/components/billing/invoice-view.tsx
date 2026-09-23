import type * as React from "react";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail-list";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import type { Tables } from "@/lib/db/database.types";
import { formatDate } from "@/lib/domain/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";

/** Invoice body shared by the dashboard and the carrier portal. */
export function InvoiceView({
  invoice,
  lines,
  payments,
  billedBy,
  billTo,
  aside,
}: {
  invoice: Tables<"invoices">;
  lines: Array<Tables<"invoice_line_items">>;
  payments: Array<Pick<Tables<"payments">, "id" | "amount" | "method" | "status" | "reference" | "received_at">>;
  billedBy: { name: string; lines: string[] };
  billTo: { name: string; lines: string[] };
  aside?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice {invoice.invoice_number}</CardTitle>
        <StatusBadge status={invoice.status} />
      </CardHeader>
      <CardBody className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="text-sm">
            <p className="text-xs font-semibold tracking-wide text-steel-600 uppercase">From</p>
            <p className="font-semibold">{billedBy.name}</p>
            {billedBy.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
          <div className="text-sm">
            <p className="text-xs font-semibold tracking-wide text-steel-600 uppercase">Bill to</p>
            <p className="font-semibold">{billTo.name}</p>
            {billTo.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        </div>
        <DetailList
          columns={3}
          items={[
            ["Issued", formatDate(invoice.issue_date)],
            ["Due", formatDate(invoice.due_date)],
            ["Paid", invoice.paid_at ? formatDate(invoice.paid_at) : null],
          ]}
        />
        {invoice.memo ? <p className="text-sm text-steel-700">{invoice.memo}</p> : null}
      </CardBody>
      <Table caption="Invoice lines">
        <THead>
          <tr>
            <TH>Description</TH>
            <TH className="text-right">Amount</TH>
          </tr>
        </THead>
        <tbody>
          {lines.map((l) => (
            <TR key={l.id}>
              <TD>{l.description}</TD>
              <TD className="text-right tabular-nums">{formatMoney(l.amount)}</TD>
            </TR>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-steel-200 text-sm">
          <tr>
            <th scope="row" className="px-4 py-1 text-right font-normal">
              Total
            </th>
            <td className="px-4 py-1 text-right font-semibold tabular-nums">{formatMoney(invoice.total)}</td>
          </tr>
          <tr>
            <th scope="row" className="px-4 py-1 text-right font-normal">
              Paid
            </th>
            <td className="px-4 py-1 text-right tabular-nums">{formatMoney(invoice.amount_paid)}</td>
          </tr>
          <tr>
            <th scope="row" className="px-4 py-2 text-right text-base font-semibold">
              Balance due
            </th>
            <td className="px-4 py-2 text-right text-base font-semibold tabular-nums">{formatMoney(invoice.balance_due)}</td>
          </tr>
        </tfoot>
      </Table>
      {payments.length ? (
        <CardBody className="border-t border-steel-200">
          <h3 className="mb-2 text-sm font-semibold">Payments</h3>
          <ul className="space-y-1 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span>
                  {formatDate(p.received_at)} · {PAYMENT_METHOD_LABELS[p.method]}
                  {p.reference ? ` · ref ${p.reference}` : ""}
                  {p.status !== "succeeded" ? ` · ${p.status}` : ""}
                </span>
                <span className="tabular-nums">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      ) : null}
      {aside}
      <CardBody className="border-t border-steel-200 text-xs text-steel-600">
        This invoice covers dispatch services only. Freight charges are billed by the carrier to the broker and are never collected by the dispatch company.
      </CardBody>
    </Card>
  );
}

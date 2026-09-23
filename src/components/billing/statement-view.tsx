import type * as React from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import type { Tables } from "@/lib/db/database.types";
import { formatMoney } from "@/lib/domain/money";

type Line = Tables<"statement_line_items">;

const LINE_LABELS: Record<string, string> = {
  load_fee: "Load fee",
  flat_weekly_fee: "Weekly truck fee",
  credit: "Credit",
  adjustment: "Adjustment",
};

/** Statement body shared by the dashboard and the carrier portal. */
export function StatementView({
  statement,
  lines,
  lineAction,
}: {
  statement: Tables<"weekly_statements">;
  lines: Line[];
  lineAction?: (line: Line) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Statement detail</CardTitle>
        <span className="text-sm text-steel-600">{statement.fee_model === "flat_weekly" ? "Flat weekly per active truck" : "Percentage of eligible revenue"}</span>
      </CardHeader>
      <Table caption="Statement lines">
        <THead>
          <tr>
            <TH>Item</TH>
            <TH className="text-right">Carrier gross</TH>
            <TH className="text-right">Accessorials</TH>
            <TH className="text-right">Eligible</TH>
            <TH className="text-right">Amount</TH>
            {lineAction ? (
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            ) : null}
          </tr>
        </THead>
        <tbody>
          {lines.map((l) => (
            <TR key={l.id}>
              <TD>
                <span className="font-medium">{l.description}</span>
                <div className="text-xs text-steel-600">{LINE_LABELS[l.line_type] ?? l.line_type}</div>
              </TD>
              <TD className="text-right tabular-nums">{l.line_type === "load_fee" ? formatMoney(l.gross_revenue) : ""}</TD>
              <TD className="text-right tabular-nums">{l.line_type === "load_fee" ? formatMoney(l.additional_charges) : ""}</TD>
              <TD className="text-right tabular-nums">{l.line_type === "load_fee" ? formatMoney(l.eligible_revenue) : ""}</TD>
              <TD className="text-right font-medium tabular-nums">{formatMoney(l.amount)}</TD>
              {lineAction ? <TD className="text-right">{lineAction(l)}</TD> : null}
            </TR>
          ))}
          {lines.length === 0 ? (
            <TR>
              <TD colSpan={6} className="text-steel-600">
                No completed loads or weekly fees for this period.
              </TD>
            </TR>
          ) : null}
        </tbody>
        <tfoot className="border-t-2 border-steel-200 text-sm">
          <tr>
            <th scope="row" className="px-4 py-2 text-left font-semibold">
              Totals ({statement.loads_count} loads)
            </th>
            <td className="px-4 py-2 text-right tabular-nums">{formatMoney(statement.gross_load_revenue)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatMoney(statement.additional_charges)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatMoney(statement.eligible_revenue)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatMoney(statement.dispatch_fee)}</td>
            {lineAction ? <td /> : null}
          </tr>
          <tr>
            <th scope="row" colSpan={4} className="px-4 py-1 text-right font-normal text-steel-700">
              Credits and adjustments
            </th>
            <td className="px-4 py-1 text-right tabular-nums">{formatMoney(statement.credits_adjustments)}</td>
            {lineAction ? <td /> : null}
          </tr>
          <tr>
            <th scope="row" colSpan={4} className="px-4 py-2 text-right text-base font-semibold">
              Dispatch fee due
            </th>
            <td className="px-4 py-2 text-right text-base font-semibold tabular-nums">{formatMoney(statement.amount_due)}</td>
            {lineAction ? <td /> : null}
          </tr>
        </tfoot>
      </Table>
    </Card>
  );
}

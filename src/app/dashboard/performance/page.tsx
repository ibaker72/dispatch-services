import { BarChart3, Download } from "lucide-react";
import Link from "next/link";
import { WeekNav } from "@/components/dashboard/week-nav";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth/session";
import { type RawSearchParams, flatParams } from "@/lib/db/query";
import { parseWeek, weekStart } from "@/lib/domain/dates";
import { aggregatePerformance } from "@/lib/domain/mileage";
import { formatMoney, sumCents, toCents, centsToDecimal } from "@/lib/domain/money";
import { formatMiles, formatRate } from "@/lib/domain/mileage";
import { weeklyPerformance } from "@/lib/reports/performance";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Performance" };

export default async function PerformancePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const params = flatParams(await searchParams);
  const { timezone } = await getOperationsSettings();
  const current = weekStart(new Date(), timezone);
  const week = parseWeek(params.week, current);
  const rows = await weeklyPerformance(ctx.supabase, week);

  const totals = aggregatePerformance(rows.map((r) => ({ grossRate: r.carrierGross, loadedMiles: r.loadedMiles, deadheadMiles: r.deadheadMiles })));
  const carrierGross = centsToDecimal(sumCents(rows.map((r) => toCents(r.carrierGross))));
  const fees = centsToDecimal(sumCents(rows.map((r) => toCents(r.dispatchFee))));

  return (
    <>
      <PageHeader
        title="Weekly performance"
        description="Completed loads by carrier for the statement week. Carrier gross is the carriers' revenue; dispatch fees are ours. Flat weekly fees appear on statements, not per load."
        actions={
          <>
            <WeekNav base="/dashboard/performance" week={week} current={current} />
            <a
              href={`/api/exports/performance?week=${week}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-steel-300 bg-white px-3 text-sm font-semibold text-navy-900 hover:bg-paper-2"
            >
              <Download className="size-4" aria-hidden="true" /> CSV
            </a>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Completed loads" value={rows.reduce((a, r) => a + r.loads, 0).toLocaleString()} />
        <Stat label="Carrier gross revenue" value={formatMoney(carrierGross)} tone="carrier" hint="Earned by carriers" />
        <Stat label="Per-load dispatch fees" value={formatMoney(fees)} tone="company" hint="Dispatch-company revenue" />
        <Stat label="Deadhead" value={totals.deadheadPercentage ? `${totals.deadheadPercentage}%` : "—"} hint={`${formatMiles(totals.deadheadMiles)} of ${formatMiles(totals.totalMiles)}`} />
      </div>
      {rows.length ? (
        <Card>
          <Table caption="Carrier performance for the week">
            <THead>
              <tr>
                <TH>Carrier</TH>
                <TH className="text-right">Loads</TH>
                <TH className="text-right">Carrier gross</TH>
                <TH className="text-right">Loaded mi</TH>
                <TH className="text-right">Deadhead</TH>
                <TH className="text-right">Loaded RPM</TH>
                <TH className="text-right">All-in RPM</TH>
                <TH className="text-right">Dispatch fee</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={r.carrierId}>
                  <TD>
                    <Link href={`/dashboard/carriers/${r.carrierId}`} className="font-medium hover:underline">
                      {r.carrierName}
                    </Link>
                  </TD>
                  <TD className="text-right tabular-nums">{r.loads}</TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(r.carrierGross)}
                    {Number(r.accessorials) ? <div className="text-xs text-steel-600">incl. {formatMoney(r.accessorials)} accessorials</div> : null}
                  </TD>
                  <TD className="text-right tabular-nums">{formatMiles(r.loadedMiles)}</TD>
                  <TD className="text-right tabular-nums">
                    {formatMiles(r.deadheadMiles)}
                    {r.deadheadPercentage ? <div className="text-xs text-steel-600">{r.deadheadPercentage}%</div> : null}
                  </TD>
                  <TD className="text-right tabular-nums">{formatRate(r.loadedRatePerMile)}</TD>
                  <TD className="text-right tabular-nums">{formatRate(r.allInRatePerMile)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(r.dispatchFee)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState icon={BarChart3} title="No completed loads this week">
          Performance is calculated from loads completed in the selected statement week.
        </EmptyState>
      )}
    </>
  );
}

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireCarrierUser } from "@/lib/auth/session";
import { addDays, formatDate, weekStart } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { formatMiles, formatRate } from "@/lib/domain/mileage";
import { weeklyPerformance } from "@/lib/reports/performance";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Performance" };

export default async function PortalPerformancePage() {
  const ctx = await requireCarrierUser();
  const { timezone } = await getOperationsSettings();
  const current = weekStart(new Date(), timezone);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(current, -7 * i));
  const rows = await Promise.all(weeks.map(async (w) => ({ week: w, perf: (await weeklyPerformance(ctx.supabase, w, ctx.membership.carrierId))[0] })));

  return (
    <>
      <PageHeader
        title="Weekly performance"
        description="Your completed loads over the last eight weeks. Gross is your revenue from brokers; the dispatch fee is what you owe us for dispatch service."
      />
      <Card>
        <Table caption="Weekly performance">
          <THead>
            <tr>
              <TH>Week</TH>
              <TH className="text-right">Loads</TH>
              <TH className="text-right">Your gross</TH>
              <TH className="text-right">Loaded miles</TH>
              <TH className="text-right">Deadhead</TH>
              <TH className="text-right">Loaded RPM</TH>
              <TH className="text-right">All-in RPM</TH>
              <TH className="text-right">Per-load dispatch fees</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map(({ week, perf }) => (
              <TR key={week}>
                <TD>
                  {formatDate(week, { month: "short", day: "numeric" })} – {formatDate(addDays(week, 6), { month: "short", day: "numeric" })}
                  {week === current ? <span className="ml-1 text-xs text-steel-600">(this week)</span> : null}
                </TD>
                <TD className="text-right tabular-nums">{perf?.loads ?? 0}</TD>
                <TD className="text-right tabular-nums">{formatMoney(perf?.carrierGross ?? 0)}</TD>
                <TD className="text-right tabular-nums">{formatMiles(perf?.loadedMiles ?? 0)}</TD>
                <TD className="text-right tabular-nums">
                  {formatMiles(perf?.deadheadMiles ?? 0)}
                  {perf?.deadheadPercentage ? <span className="block text-xs text-steel-600">{perf.deadheadPercentage}%</span> : null}
                </TD>
                <TD className="text-right tabular-nums">{formatRate(perf?.loadedRatePerMile)}</TD>
                <TD className="text-right tabular-nums">{formatRate(perf?.allInRatePerMile)}</TD>
                <TD className="text-right tabular-nums">{formatMoney(perf?.dispatchFee ?? 0)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-steel-600">Flat weekly plans are billed per active truck on your weekly statement rather than per load.</p>
    </>
  );
}

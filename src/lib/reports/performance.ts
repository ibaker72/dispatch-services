import "server-only";
import { addDays } from "@/lib/domain/dates";
import { aggregatePerformance } from "@/lib/domain/mileage";
import { centsToDecimal, toCents } from "@/lib/domain/money";
import type { UserSupabaseClient } from "@/lib/supabase/server";

export interface CarrierWeekPerformance {
  carrierId: string;
  carrierName: string;
  loads: number;
  carrierGross: string;
  accessorials: string;
  dispatchFee: string;
  loadedMiles: string;
  deadheadMiles: string;
  loadedRatePerMile: string | null;
  allInRatePerMile: string | null;
  deadheadPercentage: string | null;
}

/**
 * Weekly performance from immutable fee snapshots (one per completed or TONU
 * load), grouped by carrier. RLS limits dispatchers to their carriers.
 * Flat weekly fees are billed per truck on the statement, so dispatch fees
 * here are the per-load fees only; statements carry the weekly totals.
 */
export async function weeklyPerformance(supabase: UserSupabaseClient, weekStart: string, carrierId?: string): Promise<CarrierWeekPerformance[]> {
  let query = supabase
    .from("fee_snapshots")
    .select("carrier_id, gross_rate, total_revenue, dispatch_fee, loaded_miles, deadhead_miles, carriers(legal_name)")
    .eq("statement_week", weekStart);
  if (carrierId) query = query.eq("carrier_id", carrierId);
  const { data } = await query;
  const groups = new Map<string, NonNullable<typeof data>>();
  for (const row of data ?? []) {
    const list = groups.get(row.carrier_id) ?? [];
    list.push(row);
    groups.set(row.carrier_id, list);
  }
  return [...groups.entries()]
    .map(([id, rows]) => {
      const perf = aggregatePerformance(rows.map((r) => ({ grossRate: r.gross_rate, loadedMiles: r.loaded_miles, deadheadMiles: r.deadhead_miles })));
      const total = rows.reduce((a, r) => a + toCents(r.total_revenue), 0n);
      const gross = rows.reduce((a, r) => a + toCents(r.gross_rate), 0n);
      return {
        carrierId: id,
        carrierName: rows[0]?.carriers?.legal_name ?? "",
        loads: rows.length,
        carrierGross: centsToDecimal(total),
        accessorials: centsToDecimal(total - gross),
        dispatchFee: centsToDecimal(rows.reduce((a, r) => a + toCents(r.dispatch_fee), 0n)),
        loadedMiles: perf.loadedMiles,
        deadheadMiles: perf.deadheadMiles,
        loadedRatePerMile: perf.loadedRatePerMile,
        allInRatePerMile: perf.allInRatePerMile,
        deadheadPercentage: perf.deadheadPercentage,
      };
    })
    .sort((a, b) => a.carrierName.localeCompare(b.carrierName));
}

export const weekEnd = (weekStart: string) => addDays(weekStart, 6);

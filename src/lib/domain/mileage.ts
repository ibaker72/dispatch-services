/**
 * Mileage and rate-per-mile calculations (exact decimal arithmetic).
 *
 *   loaded rate per mile = line-haul gross ÷ loaded miles
 *   all-in rate per mile = line-haul gross ÷ (loaded miles + deadhead miles)
 *   deadhead percentage  = deadhead miles ÷ (loaded miles + deadhead miles)
 *
 * Matches the generated columns on public.loads (4 decimal places) and the
 * dashboard aggregates (2 decimal places, weighted by miles).
 */
import { divRoundHalfAwayFromZero, toCents, toScaled } from "./money";

const TENTHS = 1;

function tenths(miles: string | number | null | undefined): bigint {
  return toScaled(miles, TENTHS);
}

function scaledToString(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${whole}${scale > 0 ? `.${fraction}` : ""}`;
}

export function totalMiles(loaded: string | number | null, deadhead: string | number | null): string {
  return scaledToString(tenths(loaded) + tenths(deadhead), 1);
}

/** Dollars per mile with `decimals` places, or null when there are no miles. */
function ratePerMile(gross: string | number | null, miles: bigint, decimals: number): string | null {
  if (miles <= 0n) return null;
  const cents = toCents(gross);
  // gross$/miles = (cents/100) / (tenths/10) ; scaled by 10^decimals
  const scaled = divRoundHalfAwayFromZero(cents * 10n * 10n ** BigInt(decimals), miles * 100n);
  return scaledToString(scaled, decimals);
}

export function loadedRatePerMile(gross: string | number | null, loadedMiles: string | number | null, decimals = 4): string | null {
  return ratePerMile(gross, tenths(loadedMiles), decimals);
}

export function allInRatePerMile(
  gross: string | number | null,
  loadedMiles: string | number | null,
  deadheadMiles: string | number | null,
  decimals = 4,
): string | null {
  return ratePerMile(gross, tenths(loadedMiles) + tenths(deadheadMiles), decimals);
}

export function deadheadPercentage(loadedMiles: string | number | null, deadheadMiles: string | number | null): string | null {
  const total = tenths(loadedMiles) + tenths(deadheadMiles);
  if (total <= 0n) return null;
  return scaledToString(divRoundHalfAwayFromZero(tenths(deadheadMiles) * 1000n, total), 1);
}

export interface MileageRow {
  grossRate: string | number | null;
  loadedMiles: string | number | null;
  deadheadMiles: string | number | null;
}

/** Mile-weighted performance over many loads (e.g. a carrier's week). */
export function aggregatePerformance(rows: MileageRow[]) {
  const gross = rows.reduce((acc, r) => acc + toCents(r.grossRate), 0n);
  const loaded = rows.reduce((acc, r) => acc + tenths(r.loadedMiles), 0n);
  const deadhead = rows.reduce((acc, r) => acc + tenths(r.deadheadMiles), 0n);
  const grossDecimal = scaledToString(gross, 2);
  const loadedDecimal = scaledToString(loaded, 1);
  const deadheadDecimal = scaledToString(deadhead, 1);
  return {
    gross: grossDecimal,
    loadedMiles: loadedDecimal,
    deadheadMiles: deadheadDecimal,
    totalMiles: scaledToString(loaded + deadhead, 1),
    loadedRatePerMile: loadedRatePerMile(grossDecimal, loadedDecimal, 2),
    allInRatePerMile: allInRatePerMile(grossDecimal, loadedDecimal, deadheadDecimal, 2),
    deadheadPercentage: deadheadPercentage(loadedDecimal, deadheadDecimal),
  };
}

export function formatRate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `$${Number(value).toFixed(2)}/mi`;
}

export function formatMiles(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(value))} mi`;
}

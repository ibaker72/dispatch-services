/**
 * Dispatch fee calculations. The database computes the authoritative values
 * (loads estimate trigger, fee snapshots, weekly statements); this module
 * mirrors that math for previews and is cross-checked against the database in
 * tests/db/fee-parity.test.ts.
 *
 *   percentage plans: fee = eligible completed-load revenue × contracted percentage
 *   flat plans:       fee = flat weekly amount × active trucks
 *
 * Eligible revenue = line-haul gross + the accessorials the contract includes
 * (detention, layover, TONU, other). Lumper reimbursements are pass-through
 * and never eligible.
 */
import { type Cents, applyRate, formatCents, sumCents, toCents, toScaled } from "./money";

export type FeeModel = "percentage" | "flat_weekly";

export interface FeeTerms {
  model: FeeModel;
  percentage: string | number | null;
  flatWeeklyAmount: string | number | null;
  includeDetention: boolean;
  includeLayover: boolean;
  includeTonu: boolean;
  includeOther: boolean;
}

export interface LoadRevenueInput {
  grossRate: string | number | null;
  detention?: string | number | null;
  layover?: string | number | null;
  tonu?: string | number | null;
  other?: string | number | null;
  lumperReimbursement?: string | number | null;
}

export interface LoadFeeBreakdown {
  gross: Cents;
  accessorials: Cents;
  totalRevenue: Cents;
  eligibleRevenue: Cents;
  dispatchFee: Cents;
  carrierEstimatedNet: Cents;
}

export function calculateLoadFee(input: LoadRevenueInput, terms: FeeTerms): LoadFeeBreakdown {
  const gross = toCents(input.grossRate);
  const detention = toCents(input.detention);
  const layover = toCents(input.layover);
  const tonu = toCents(input.tonu);
  const other = toCents(input.other);
  const accessorials = sumCents([detention, layover, tonu, other]);
  const eligibleRevenue = sumCents([
    gross,
    terms.includeDetention ? detention : 0n,
    terms.includeLayover ? layover : 0n,
    terms.includeTonu ? tonu : 0n,
    terms.includeOther ? other : 0n,
  ]);
  let dispatchFee = 0n;
  if (terms.model === "percentage") {
    if (terms.percentage === null || terms.percentage === undefined) throw new Error("percentage plan without a percentage");
    dispatchFee = applyRate(eligibleRevenue, terms.percentage);
  }
  const totalRevenue = gross + accessorials;
  return {
    gross,
    accessorials,
    totalRevenue,
    eligibleRevenue,
    dispatchFee,
    carrierEstimatedNet: totalRevenue - dispatchFee,
  };
}

export function flatWeeklyFee(terms: FeeTerms, activeTrucks: number): Cents {
  if (terms.model !== "flat_weekly") return 0n;
  if (!Number.isInteger(activeTrucks) || activeTrucks < 0) throw new RangeError("active truck count must be a non-negative integer");
  return toCents(terms.flatWeeklyAmount) * BigInt(activeTrucks);
}

export interface StatementLine {
  type: "load_fee" | "flat_weekly_fee" | "credit" | "adjustment";
  amount: Cents;
  grossRevenue?: Cents;
  additionalCharges?: Cents;
  eligibleRevenue?: Cents;
}

export interface StatementTotals {
  loadsCount: number;
  grossLoadRevenue: Cents;
  additionalCharges: Cents;
  eligibleRevenue: Cents;
  dispatchFee: Cents;
  creditsAdjustments: Cents;
  amountDue: Cents;
}

export function statementTotals(lines: StatementLine[]): StatementTotals {
  const loadLines = lines.filter((l) => l.type === "load_fee");
  const feeLines = lines.filter((l) => l.type === "load_fee" || l.type === "flat_weekly_fee");
  const creditLines = lines.filter((l) => l.type === "credit" || l.type === "adjustment");
  const dispatchFee = sumCents(feeLines.map((l) => l.amount));
  const creditsAdjustments = sumCents(creditLines.map((l) => l.amount));
  return {
    loadsCount: loadLines.length,
    grossLoadRevenue: sumCents(loadLines.map((l) => l.grossRevenue ?? 0n)),
    additionalCharges: sumCents(loadLines.map((l) => l.additionalCharges ?? 0n)),
    eligibleRevenue: sumCents(loadLines.map((l) => l.eligibleRevenue ?? 0n)),
    dispatchFee,
    creditsAdjustments,
    amountDue: dispatchFee + creditsAdjustments,
  };
}

/** "0.0700" → "7%", "0.0625" → "6.25%". */
export function formatRatePercent(rate: string | number | null | undefined): string {
  const tenThousandths = toScaled(rate ?? 0, 4); // 700n for 7%
  const whole = tenThousandths / 100n;
  const fraction = (tenThousandths % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

export function describeFeeTerms(terms: Pick<FeeTerms, "model" | "percentage" | "flatWeeklyAmount">): string {
  if (terms.model === "percentage") {
    return `${formatRatePercent(terms.percentage)} of eligible gross revenue on completed loads`;
  }
  return `${formatCents(toCents(terms.flatWeeklyAmount))} per active truck per week`;
}

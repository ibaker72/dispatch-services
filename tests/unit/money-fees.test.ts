import { describe, expect, it } from "vitest";
import { calculateLoadFee, describeFeeTerms, type FeeTerms, flatWeeklyFee, formatRatePercent, statementTotals } from "@/lib/domain/fees";
import { applyRate, centsToDecimal, divRoundHalfAwayFromZero, formatMoney, toCents, toScaled } from "@/lib/domain/money";

const PERCENT_7: FeeTerms = {
  model: "percentage",
  percentage: "0.0700",
  flatWeeklyAmount: null,
  includeDetention: true,
  includeLayover: true,
  includeTonu: true,
  includeOther: false,
};

const FLAT_300: FeeTerms = { ...PERCENT_7, model: "flat_weekly", percentage: null, flatWeeklyAmount: "300.00" };

describe("money", () => {
  it("parses decimal strings exactly into cents", () => {
    expect(toCents("1234.56")).toBe(123456n);
    expect(toCents("0.1")).toBe(10n);
    expect(toCents("1,250.00")).toBe(125000n);
    expect(toCents(0.1 + 0.2)).toBe(30n);
    expect(toCents(null)).toBe(0n);
    expect(toCents("-25.5")).toBe(-2550n);
  });

  it("rounds extra decimals half away from zero like PostgreSQL", () => {
    expect(toCents("2.345")).toBe(235n);
    expect(toCents("2.344")).toBe(234n);
    expect(toCents("-2.345")).toBe(-235n);
    expect(divRoundHalfAwayFromZero(5n, 2n)).toBe(3n);
    expect(divRoundHalfAwayFromZero(-5n, 2n)).toBe(-3n);
  });

  it("rejects non-numeric input", () => {
    expect(() => toCents("12abc")).toThrow(RangeError);
    expect(() => toCents(Number.NaN)).toThrow(RangeError);
  });

  it("formats cents without floating-point drift", () => {
    expect(centsToDecimal(123456n)).toBe("1234.56");
    expect(centsToDecimal(-5n)).toBe("-0.05");
    expect(formatMoney("185.5")).toBe("$185.50");
    expect(formatMoney(null)).toBe("—");
  });

  it("applies percentage rates exactly", () => {
    expect(applyRate(265000n, "0.07")).toBe(18550n);
    expect(applyRate(123457n, "0.07")).toBe(8642n); // 8641.99 → 8642
    expect(applyRate(100n, "0.005")).toBe(1n); // 0.5 cent rounds away from zero
    expect(toScaled("0.0700", 4)).toBe(700n);
  });
});

describe("dispatch fee calculations", () => {
  it("percentage fee = eligible revenue × contracted percentage", () => {
    const fee = calculateLoadFee({ grossRate: "2500.00", detention: "150.00" }, PERCENT_7);
    expect(fee.eligibleRevenue).toBe(265000n);
    expect(fee.dispatchFee).toBe(18550n);
    expect(fee.totalRevenue).toBe(265000n);
    expect(fee.carrierEstimatedNet).toBe(246450n);
  });

  it("excludes accessorials the contract does not include", () => {
    const terms = { ...PERCENT_7, includeDetention: false };
    const fee = calculateLoadFee({ grossRate: "2500", detention: "200", layover: "100", lumperReimbursement: "80" }, terms);
    expect(fee.eligibleRevenue).toBe(260000n);
    expect(fee.dispatchFee).toBe(18200n);
    // Lumper reimbursements are pass-through: never revenue, never eligible.
    expect(fee.totalRevenue).toBe(280000n);
  });

  it("includes 'other' charges only when the contract says so", () => {
    expect(calculateLoadFee({ grossRate: "1000", other: "100" }, PERCENT_7).eligibleRevenue).toBe(100000n);
    expect(calculateLoadFee({ grossRate: "1000", other: "100" }, { ...PERCENT_7, includeOther: true }).eligibleRevenue).toBe(110000n);
  });

  it("TONU-only revenue is billed when included", () => {
    expect(calculateLoadFee({ grossRate: "0", tonu: "250" }, PERCENT_7).dispatchFee).toBe(1750n);
    expect(calculateLoadFee({ grossRate: "0", tonu: "250" }, { ...PERCENT_7, includeTonu: false }).dispatchFee).toBe(0n);
  });

  it("flat plans charge nothing per load and a fixed amount per active truck", () => {
    expect(calculateLoadFee({ grossRate: "3000" }, FLAT_300).dispatchFee).toBe(0n);
    expect(flatWeeklyFee(FLAT_300, 2)).toBe(60000n);
    expect(flatWeeklyFee(FLAT_300, 0)).toBe(0n);
    expect(flatWeeklyFee(PERCENT_7, 5)).toBe(0n);
    expect(() => flatWeeklyFee(FLAT_300, -1)).toThrow(RangeError);
  });

  it("summarizes weekly statements with credits", () => {
    const totals = statementTotals([
      { type: "load_fee", amount: 18200n, grossRevenue: 250000n, additionalCharges: 10000n, eligibleRevenue: 260000n },
      { type: "load_fee", amount: 12600n, grossRevenue: 180000n, additionalCharges: 0n, eligibleRevenue: 180000n },
      { type: "credit", amount: -2500n },
    ]);
    expect(totals).toEqual({
      loadsCount: 2,
      grossLoadRevenue: 430000n,
      additionalCharges: 10000n,
      eligibleRevenue: 440000n,
      dispatchFee: 30800n,
      creditsAdjustments: -2500n,
      amountDue: 28300n,
    });
  });

  it("describes fee terms for carriers", () => {
    expect(formatRatePercent("0.0700")).toBe("7%");
    expect(formatRatePercent("0.0625")).toBe("6.25%");
    expect(describeFeeTerms(PERCENT_7)).toBe("7% of eligible gross revenue on completed loads");
    expect(describeFeeTerms(FLAT_300)).toBe("$300.00 per active truck per week");
  });
});

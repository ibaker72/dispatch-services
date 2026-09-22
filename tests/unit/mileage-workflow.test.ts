import { describe, expect, it } from "vitest";
import { addDays, daysUntil, localDate, weekStart } from "@/lib/domain/dates";
import { evaluateLeaseOn, LEASE_ON_REQUIREMENTS } from "@/lib/domain/lease-on";
import {
  LOAD_STATUSES,
  LOAD_TRANSITIONS,
  bookingBlockers,
  canTransition,
  dispatcherNextStatuses,
} from "@/lib/domain/load-workflow";
import { aggregatePerformance, allInRatePerMile, deadheadPercentage, loadedRatePerMile, totalMiles } from "@/lib/domain/mileage";

describe("mileage and rate per mile", () => {
  it("matches the database's generated columns", () => {
    expect(totalMiles("1200.0", "300.0")).toBe("1500.0");
    expect(loadedRatePerMile("3000.00", "1200.0")).toBe("2.5000");
    expect(allInRatePerMile("3000.00", "1200.0", "300.0")).toBe("2.0000");
    expect(loadedRatePerMile("2500.00", "1000.0")).toBe("2.5000");
    expect(allInRatePerMile("2500.00", "1000.0", "100.0")).toBe("2.2727");
  });

  it("returns null rather than dividing by zero", () => {
    expect(loadedRatePerMile("1000", "0")).toBeNull();
    expect(allInRatePerMile("1000", null, null)).toBeNull();
    expect(deadheadPercentage(0, 0)).toBeNull();
  });

  it("computes deadhead percentage", () => {
    expect(deadheadPercentage("900", "100")).toBe("10.0");
    expect(deadheadPercentage("1000.0", "123.4")).toBe("11.0");
  });

  it("aggregates weighted performance across loads", () => {
    const agg = aggregatePerformance([
      { grossRate: "2500.00", loadedMiles: "1000", deadheadMiles: "100" },
      { grossRate: "1500.00", loadedMiles: "500", deadheadMiles: "150" },
    ]);
    expect(agg).toEqual({
      gross: "4000.00",
      loadedMiles: "1500.0",
      deadheadMiles: "250.0",
      totalMiles: "1750.0",
      loadedRatePerMile: "2.67",
      allInRatePerMile: "2.29",
      deadheadPercentage: "14.3",
    });
  });
});

describe("load workflow rules", () => {
  it("defines transitions for every status and closes completed/cancelled", () => {
    for (const status of LOAD_STATUSES) expect(LOAD_TRANSITIONS[status]).toBeDefined();
    expect(LOAD_TRANSITIONS.completed).toEqual([]);
    expect(LOAD_TRANSITIONS.cancelled).toEqual([]);
  });

  it("cannot skip carrier approval on the way to booked", () => {
    expect(canTransition("proposed", "booked")).toBe(false);
    expect(canTransition("opportunity", "booked")).toBe(false);
    expect(canTransition("approved", "booked")).toBe(true);
  });

  it("dispatchers cannot mark loads approved themselves", () => {
    expect(dispatcherNextStatuses("proposed")).not.toContain("approved");
    expect(dispatcherNextStatuses("proposed")).toEqual(["opportunity", "cancelled"]);
  });

  it("loaded freight can no longer be cancelled from the workflow", () => {
    expect(canTransition("loaded", "cancelled")).toBe(false);
    expect(canTransition("in_transit", "cancelled")).toBe(false);
  });

  it("explains every missing booking requirement", () => {
    const blockers = bookingBlockers({
      status: "proposed",
      truckId: null,
      driverId: null,
      grossRate: null,
      loadedMiles: 0,
      pickupStops: 1,
      deliveryStops: 0,
      hasValidApproval: false,
      carrierContracted: false,
    });
    expect(blockers).toHaveLength(8);
    expect(
      bookingBlockers({
        status: "approved",
        truckId: "t",
        driverId: "d",
        grossRate: "2500",
        loadedMiles: "900",
        pickupStops: 1,
        deliveryStops: 1,
        hasValidApproval: true,
        carrierContracted: true,
      }),
    ).toEqual([]);
  });
});

describe("lease-on gate", () => {
  const all = Object.fromEntries(LEASE_ON_REQUIREMENTS.map((r) => [r.key, true]));

  it("is disabled by default", () => {
    expect(evaluateLeaseOn({ envEnabled: false, flagEnabled: false, requirements: {} }).enabled).toBe(false);
  });

  it("requires the server env flag, the database flag and every requirement", () => {
    expect(evaluateLeaseOn({ envEnabled: true, flagEnabled: true, requirements: all }).enabled).toBe(true);
    expect(evaluateLeaseOn({ envEnabled: false, flagEnabled: true, requirements: all }).enabled).toBe(false);
    expect(evaluateLeaseOn({ envEnabled: true, flagEnabled: false, requirements: all }).enabled).toBe(false);
    for (const r of LEASE_ON_REQUIREMENTS) {
      const decision = evaluateLeaseOn({ envEnabled: true, flagEnabled: true, requirements: { ...all, [r.key]: false } });
      expect(decision.enabled).toBe(false);
      expect(decision.missing).toEqual([r.key]);
    }
  });

  it("lists the seven configuration values the specification requires", () => {
    expect(LEASE_ON_REQUIREMENTS.map((r) => r.key)).toEqual([
      "usdot_number",
      "mc_number",
      "authority_effective_date",
      "insurance_filing_verified",
      "boc3_verified",
      "compliance_administrator",
      "attorney_approved_lease_version",
    ]);
  });
});

describe("business-timezone dates", () => {
  it("computes the Monday week start in Chicago time", () => {
    // Monday 2026-09-21 03:00 UTC is still Sunday 22:00 in Chicago.
    expect(weekStart(new Date("2026-09-21T03:00:00Z"), "America/Chicago")).toBe("2026-09-14");
    expect(weekStart(new Date("2026-09-21T06:00:00Z"), "America/Chicago")).toBe("2026-09-21");
    expect(weekStart(new Date("2026-09-27T23:00:00Z"), "America/Chicago")).toBe("2026-09-21");
  });

  it("handles DST boundaries", () => {
    expect(localDate(new Date("2026-03-08T07:30:00Z"), "America/Chicago")).toBe("2026-03-08");
    expect(weekStart(new Date("2026-11-01T12:00:00Z"), "America/Chicago")).toBe("2026-10-26");
  });

  it("adds days and counts days until", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysUntil("2026-10-01", "2026-09-22")).toBe(9);
    expect(daysUntil("2026-09-20", "2026-09-22")).toBe(-2);
  });
});

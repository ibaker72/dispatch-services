/**
 * Load workflow and compliance invariants:
 *   - freight is only worked for a contracted carrier (no unassigned pool)
 *   - loads can never be reassigned to another carrier
 *   - booking requires truck, driver, rate and a carrier approval for the current rate
 *   - carrier approval is recorded with timestamp and approving person
 *   - cancelled loads return to the broker; closed loads are immutable
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVICE, SYSTEM, closePool, rollbackTx } from "./support/harness";
import { type World, advanceLoad, createCarrier, createLoad, createWorld } from "./support/world";

let w: World;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

describe("creating freight", () => {
  it("every load has a carrier; there is no unassigned load pool", async () => {
    await rollbackTx(async (tx) => {
      const { is_nullable } = await tx.one<{ is_nullable: string }>(
        SYSTEM,
        `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'loads' and column_name = 'carrier_id'`,
      );
      expect(is_nullable).toBe("NO");
      await tx.rejects(
        w.admin,
        `insert into public.loads (broker_name) values ('Broker')`,
        [],
        /null value in column "carrier_id"|row-level security|contracted carrier/,
      );
      await tx.rejects(SYSTEM, `insert into public.loads (broker_name) values ('Broker')`, [], /contracted carrier|null value/);
    });
  });

  it("loads can only be created for an active, contracted carrier", async () => {
    await rollbackTx(async (tx) => {
      const pending = await createCarrier(tx, "pending", w.suffix, { dispatcherId: w.dispatcherAId, activate: false });
      await tx.rejects(w.admin, `insert into public.loads (carrier_id, broker_name) values ($1, 'Broker')`, [pending.carrierId], /contracted carrier/);
      // Revoking the dispatch agreement makes an active carrier non-contracted.
      await tx.query(SYSTEM, `update public.agreement_acceptances set revoked_at = now(), revocation_reason = 'test' where carrier_id = $1`, [w.A.carrierId]);
      await tx.rejects(w.dispatcherA, `insert into public.loads (carrier_id, broker_name) values ($1, 'Broker')`, [w.A.carrierId], /contracted carrier/);
    });
  });

  it("new loads start as opportunities", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(
        w.dispatcherA,
        `insert into public.loads (carrier_id, broker_name, status) values ($1, 'Broker', 'booked')`,
        [w.A.carrierId],
        /loads start as opportunities/,
      );
    });
  });

  it("carriers cannot create or edit loads directly", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(w.A.owner, `insert into public.loads (carrier_id, broker_name) values ($1, 'Broker')`, [w.A.carrierId], /row-level security/);
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "proposed" });
      expect(await tx.count(w.A.owner, `update public.loads set gross_rate = 9999 where id = $1`, [loadId])).toBe(0);
    });
  });
});

describe("reassignment is forbidden", () => {
  it("no role can move a load to another carrier", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "proposed" });
      for (const actor of [w.admin, w.superAdmin, w.dispatcherAll, SERVICE, SYSTEM]) {
        await tx.rejects(actor, `update public.loads set carrier_id = $2 where id = $1`, [loadId, w.B.carrierId], /cannot be reassigned/);
      }
    });
  });

  it("a truck or driver from another carrier cannot be assigned", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "approved" });
      await tx.rejects(w.dispatcherAll, `update public.loads set truck_id = $2 where id = $1`, [loadId, w.B.truckIds[0]], /foreign key/);
      await tx.rejects(w.dispatcherAll, `update public.loads set driver_id = $2 where id = $1`, [loadId, w.B.driverIds[0]], /foreign key/);
    });
  });

  it("removing a load from a carrier returns it to the broker (cancelled), never to a pool", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "booked" });
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'cancelled' where id = $1`, [loadId], /cancellation reason is required|loads_cancel_reason/);
      await tx.query(w.dispatcherA, `update public.loads set status = 'cancelled', cancellation_reason = 'Truck broke down; returned to broker' where id = $1`, [
        loadId,
      ]);
      const row = await tx.one<{ carrier_id: string; cancellation_disposition: string }>(
        SYSTEM,
        `select carrier_id, cancellation_disposition from public.loads where id = $1`,
        [loadId],
      );
      expect(row).toEqual({ carrier_id: w.A.carrierId, cancellation_disposition: "returned_to_broker" });
      await tx.rejects(w.admin, `update public.loads set status = 'opportunity' where id = $1`, [loadId], /closed records/);
      await tx.rejects(w.admin, `update public.loads set carrier_id = $2 where id = $1`, [loadId, w.B.carrierId], /cannot be reassigned/);
    });
  });
});

describe("booking guard", () => {
  it("cannot book without carrier approval", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "proposed" });
      await tx.query(w.dispatcherA, `update public.loads set truck_id = $2, driver_id = $3 where id = $1`, [loadId, w.A.truckIds[0], w.A.driverIds[0]]);
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'booked' where id = $1`, [loadId], /invalid load status transition proposed -> booked/);
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'approved' where id = $1`, [loadId], /carrier approval for the current rate is required/);
    });
  });

  it("cannot book without an assigned truck and driver", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "approved" });
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'booked' where id = $1`, [loadId], /truck and driver must be assigned/);
      await tx.query(w.dispatcherA, `update public.loads set truck_id = $2 where id = $1`, [loadId, w.A.truckIds[0]]);
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'booked' where id = $1`, [loadId], /truck and driver must be assigned/);
    });
  });

  it("cannot book without required rate information", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "approved" });
      await tx.query(w.dispatcherA, `update public.loads set truck_id = $2, driver_id = $3, loaded_miles = null where id = $1`, [
        loadId,
        w.A.truckIds[0],
        w.A.driverIds[0],
      ]);
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'booked' where id = $1`, [loadId], /loaded miles are required/);
    });
  });

  it("proposing requires stops and a rate", async () => {
    await rollbackTx(async (tx) => {
      const { id } = await tx.one<{ id: string }>(
        w.dispatcherA,
        `insert into public.loads (carrier_id, broker_name) values ($1, 'Broker') returning id`,
        [w.A.carrierId],
      );
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'proposed' where id = $1`, [id], /pickup and one delivery stop/);
    });
  });

  it("an inactive truck cannot be booked", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "approved" });
      await tx.query(SYSTEM, `update public.trucks set status = 'out_of_service' where id = $1`, [w.A.truckIds[0]]);
      await tx.query(w.dispatcherA, `update public.loads set truck_id = $2, driver_id = $3 where id = $1`, [loadId, w.A.truckIds[0], w.A.driverIds[0]]);
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'booked' where id = $1`, [loadId], /truck is not active/);
    });
  });

  it("books once approval, truck, driver and rate are present, recording who and when", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "proposed" });
      await tx.query(w.A.owner, `select public.respond_to_proposed_load($1, 'approved', 'Looks good')`, [loadId]);
      const approval = await tx.one<{ decided_by: string; decided_at: Date; method: string; approved_gross_rate: string }>(
        w.dispatcherA,
        `select decided_by, decided_at, method, approved_gross_rate from public.load_approvals where load_id = $1`,
        [loadId],
      );
      expect(approval.decided_by).toBe(w.A.ownerId);
      expect(approval.method).toBe("portal");
      expect(approval.decided_at).toBeInstanceOf(Date);
      expect(approval.approved_gross_rate).toBe("2500.00");
      await tx.query(w.dispatcherA, `update public.loads set truck_id = $2, driver_id = $3 where id = $1`, [loadId, w.A.truckIds[0], w.A.driverIds[0]]);
      await tx.query(w.dispatcherA, `update public.loads set status = 'booked' where id = $1`, [loadId]);
      const booked = await tx.one<{ status: string; booked_by: string; booked_at: Date | null }>(
        SYSTEM,
        `select status, booked_by, booked_at from public.loads where id = $1`,
        [loadId],
      );
      expect(booked.status).toBe("booked");
      expect(booked.booked_by).toBe(w.dispatcherAId);
      expect(booked.booked_at).toBeInstanceOf(Date);
    });
  });

  it("a rate change after approval requires the carrier to approve again", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "approved" });
      await tx.query(w.dispatcherA, `update public.loads set gross_rate = 2300 where id = $1`, [loadId]);
      const { status } = await tx.one<{ status: string }>(SYSTEM, `select status from public.loads where id = $1`, [loadId]);
      expect(status).toBe("proposed");
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'approved' where id = $1`, [loadId], /carrier approval for the current rate/);
      await tx.query(w.A.owner, `select public.respond_to_proposed_load($1, 'approved')`, [loadId]);
      const approvals = await tx.rows<{ approved_gross_rate: string; superseded_at: Date | null }>(
        SYSTEM,
        `select approved_gross_rate, superseded_at from public.load_approvals where load_id = $1 order by decided_at`,
        [loadId],
      );
      expect(approvals).toHaveLength(2);
      expect(approvals[0]).toMatchObject({ approved_gross_rate: "2500.00" });
      expect(approvals[0]!.superseded_at).not.toBeNull();
      expect(approvals[1]).toMatchObject({ approved_gross_rate: "2300.00", superseded_at: null });
    });
  });
});

describe("carrier decisions", () => {
  it("rejection needs a reason and returns the load to the dispatcher as an opportunity", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "proposed" });
      await tx.rejects(w.A.owner, `select public.respond_to_proposed_load($1, 'rejected')`, [loadId], /short reason/);
      const { status } = await tx.one<{ status: string }>(w.A.owner, `select public.respond_to_proposed_load($1, 'rejected', 'Rate too low') as status`, [loadId]);
      expect(status).toBe("opportunity");
      const { carrier_id } = await tx.one<{ carrier_id: string }>(SYSTEM, `select carrier_id from public.loads where id = $1`, [loadId]);
      expect(carrier_id).toBe(w.A.carrierId);
    });
  });

  it("carriers cannot decide on another carrier's load or on non-proposed loads", async () => {
    await rollbackTx(async (tx) => {
      const loadB = await createLoad(tx, w.B, { dispatcherId: w.dispatcherBId, advanceTo: "proposed" });
      await tx.rejects(w.A.owner, `select public.respond_to_proposed_load($1, 'approved')`, [loadB], /load not found/);
      const loadA = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "booked" });
      await tx.rejects(w.A.owner, `select public.respond_to_proposed_load($1, 'approved')`, [loadA], /only proposed loads/);
    });
  });

  it("off-portal approvals must be recorded by staff with evidence", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "proposed" });
      await tx.rejects(
        w.dispatcherA,
        `select public.record_carrier_load_decision($1, 'approved', 'phone', 'Owner', 'ok')`,
        [loadId],
        /load_approvals_recorded_evidence/,
      );
      await tx.rejects(
        w.dispatcherB,
        `select public.record_carrier_load_decision($1, 'approved', 'phone', 'Owner', 'Owner approved by phone at 2:10pm')`,
        [loadId],
        /load not found/,
      );
      await tx.query(
        w.dispatcherA,
        `select public.record_carrier_load_decision($1, 'approved', 'phone', 'Owner', 'Owner approved by phone at 2:10pm')`,
        [loadId],
      );
      const a = await tx.one<{ recorded_by: string; approver_name: string; method: string }>(
        SYSTEM,
        `select recorded_by, approver_name, method from public.load_approvals where load_id = $1`,
        [loadId],
      );
      expect(a).toEqual({ recorded_by: w.dispatcherAId, approver_name: "Owner", method: "phone" });
      await tx.rejects(w.A.owner, `insert into public.load_approvals (load_id, carrier_id, decision, method, approver_name, approved_gross_rate) values ($1, $2, 'approved', 'portal', 'x', 1)`, [loadId, w.A.carrierId], /row-level security/);
    });
  });

  it("carriers see proposed loads but not dispatcher opportunities", async () => {
    await rollbackTx(async (tx) => {
      const opp = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId });
      const proposed = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "proposed" });
      expect(await tx.count(w.A.owner, `select 1 from public.loads where id = $1`, [opp])).toBe(0);
      expect(await tx.count(w.A.owner, `select 1 from public.loads where id = $1`, [proposed])).toBe(1);
      expect(await tx.count(w.A.owner, `select 1 from public.load_stops where load_id = $1`, [proposed])).toBe(2);
    });
  });
});

describe("lifecycle", () => {
  it("rejects invalid transitions", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "booked" });
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'delivered' where id = $1`, [loadId], /invalid load status transition/);
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'proposed' where id = $1`, [loadId], /invalid load status transition/);
    });
  });

  it("completion requires the load's required documents", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "delivered" });
      await tx.rejects(w.dispatcherA, `update public.loads set status = 'completed' where id = $1`, [loadId], /required load documents are missing/);
      await advanceLoad(tx, w.A, loadId, "completed", w.dispatcherAId);
    });
  });

  it("completed loads and their details are immutable", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed" });
      await tx.rejects(w.admin, `update public.loads set gross_rate = 1 where id = $1`, [loadId], /closed records/);
      await tx.rejects(w.admin, `update public.load_stops set city = 'Elsewhere' where load_id = $1`, [loadId], /closed/);
      await tx.rejects(
        w.admin,
        `insert into public.load_charges (load_id, carrier_id, charge_type, amount) values ($1, $2, 'detention', 50)`,
        [loadId, w.A.carrierId],
        /closed/,
      );
    });
  });

  it("records every status change with the acting user", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "approved" });
      await tx.query(w.dispatcherA, `update public.loads set truck_id = $2, driver_id = $3 where id = $1`, [loadId, w.A.truckIds[0], w.A.driverIds[0]]);
      await tx.query(w.dispatcherA, `update public.loads set status = 'booked', status_note = 'Rate con signed' where id = $1`, [loadId]);
      const history = await tx.rows<{ from_status: string | null; to_status: string; changed_by: string | null; note: string | null }>(
        w.A.owner,
        `select from_status, to_status, changed_by, note from public.load_status_history where load_id = $1 order by id`,
        [loadId],
      );
      expect(history.map((h) => h.to_status)).toEqual(["opportunity", "proposed", "approved", "booked"]);
      expect(history.at(-1)).toMatchObject({ from_status: "approved", changed_by: w.dispatcherAId, note: "Rate con signed" });
      await tx.rejects(SYSTEM, `update public.load_status_history set note = 'x' where load_id = $1`, [loadId], /append-only/);
    });
  });

  it("computes rate-per-mile and fee estimates in the database", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, {
        dispatcherId: w.dispatcherAId,
        gross: "3000.00",
        loadedMiles: "1200.0",
        deadheadMiles: "300.0",
        charges: [
          { type: "detention", amount: "100.00" },
          { type: "lumper_reimbursement", amount: "75.00" },
        ],
      });
      const l = await tx.one<Record<string, string>>(
        SYSTEM,
        `select total_miles::text, loaded_rate_per_mile::text, all_in_rate_per_mile::text, eligible_revenue::text,
                estimated_dispatch_fee::text, carrier_estimated_net::text, fee_percentage::text
         from public.loads where id = $1`,
        [loadId],
      );
      expect(l).toEqual({
        total_miles: "1500.0",
        loaded_rate_per_mile: "2.5000",
        all_in_rate_per_mile: "2.0000",
        eligible_revenue: "3100.00",
        estimated_dispatch_fee: "217.00",
        carrier_estimated_net: "2883.00",
        fee_percentage: "0.0700",
      });
    });
  });
});

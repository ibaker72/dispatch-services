/**
 * Database functions added for the dashboard: atomic load creation, fee
 * contract replacement, dispatcher assignment and the staff directory, plus
 * parity between the TypeScript fee calculator and the database estimate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANON, SYSTEM, type Tx, closePool, rollbackTx } from "./support/harness";
import { type World, createWorld } from "./support/world";
import { calculateLoadFee } from "@/lib/domain/fees";
import { centsToDecimal } from "@/lib/domain/money";

let w: World;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

const stops = JSON.stringify([
  { stop_type: "pickup", city: "Dallas", state: "tx", facility_name: "Auction lot" },
  { stop_type: "delivery", city: "Atlanta", state: "GA" },
]);
const vehicles = JSON.stringify([{ vin: "1HGCM82633A004352", year: "2018", make: "Honda", model: "Accord", vehicle_type: "sedan", operable: true, pickup_sequence: 1, delivery_sequence: 2 }]);
const loadJson = (carrierId: string, dispatcherId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ carrier_id: carrierId, dispatcher_id: dispatcherId, broker_name: "Example Brokerage", gross_rate: 2100, loaded_miles: 640, deadhead_miles: 35, ...extra });

describe("create_load", () => {
  it("creates the load, ordered stops and linked vehicles in one call", async () => {
    await rollbackTx(async (tx) => {
      const { id } = await tx.one<{ id: string }>(w.dispatcherA, `select public.create_load($1::jsonb, $2::jsonb, $3::jsonb) as id`, [
        loadJson(w.A.carrierId, w.dispatcherAId),
        stops,
        vehicles,
      ]);
      const load = await tx.one<{ status: string; created_by: string; loaded_rate_per_mile: string }>(
        SYSTEM,
        `select status::text, created_by, loaded_rate_per_mile::text from public.loads where id = $1`,
        [id],
      );
      expect(load).toMatchObject({ status: "opportunity", created_by: w.dispatcherAId, loaded_rate_per_mile: "3.2813" });
      const stopRows = await tx.rows<{ sequence: number; stop_type: string; state: string }>(SYSTEM, `select sequence, stop_type, state from public.load_stops where load_id = $1 order by sequence`, [id]);
      expect(stopRows).toEqual([
        { sequence: 1, stop_type: "pickup", state: "TX" },
        { sequence: 2, stop_type: "delivery", state: "GA" },
      ]);
      const v = await tx.one<{ pickup: number; delivery: number }>(
        SYSTEM,
        `select p.sequence as pickup, d.sequence as delivery from public.load_vehicles v
         join public.load_stops p on p.id = v.pickup_stop_id join public.load_stops d on d.id = v.delivery_stop_id where v.load_id = $1`,
        [id],
      );
      expect(v).toEqual({ pickup: 1, delivery: 2 });
    });
  });

  it("refuses carriers the dispatcher cannot access, carrier users and anonymous callers", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(w.dispatcherA, `select public.create_load($1::jsonb, $2::jsonb)`, [loadJson(w.B.carrierId, w.dispatcherAId), stops], /row-level security|permission/);
      await tx.rejects(w.A.owner, `select public.create_load($1::jsonb, $2::jsonb)`, [loadJson(w.A.carrierId, w.A.ownerId), stops], /row-level security|permission/);
      await tx.rejects(ANON, `select public.create_load($1::jsonb, $2::jsonb)`, [loadJson(w.A.carrierId, w.dispatcherAId), stops], /permission denied/);
    });
  });

  it("requires a pickup and a delivery; a failure leaves nothing behind", async () => {
    await rollbackTx(async (tx) => {
      const before = await tx.one<{ n: string }>(SYSTEM, `select count(*)::text as n from public.loads where carrier_id = $1`, [w.A.carrierId]);
      const twoPickups = JSON.stringify([
        { stop_type: "pickup", city: "Dallas", state: "TX" },
        { stop_type: "pickup", city: "Austin", state: "TX" },
      ]);
      await tx.rejects(w.dispatcherA, `select public.create_load($1::jsonb, $2::jsonb)`, [loadJson(w.A.carrierId, w.dispatcherAId), twoPickups], /pickup and one delivery/);
      await tx.rejects(w.dispatcherA, `select public.create_load($1::jsonb, $2::jsonb)`, [loadJson(w.A.carrierId, w.dispatcherAId), JSON.stringify([{ stop_type: "pickup", city: "Dallas", state: "TX" }])], /pickup and one delivery/);
      const after = await tx.one<{ n: string }>(SYSTEM, `select count(*)::text as n from public.loads where carrier_id = $1`, [w.A.carrierId]);
      expect(after.n).toBe(before.n);
    });
  });

  it("cannot create freight for a carrier that is not active and contracted", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `select app.begin_internal('carrier_lifecycle')`);
      await tx.query(SYSTEM, `update public.carriers set status = 'inactive' where id = $1`, [w.A.carrierId]);
      await tx.rejects(w.dispatcherA, `select public.create_load($1::jsonb, $2::jsonb)`, [loadJson(w.A.carrierId, w.dispatcherAId), stops], /active, contracted carrier/);
    });
  });
});

describe("replace_fee_contract", () => {
  async function contracts(tx: Tx, carrierId: string) {
    return tx.rows<{ effective_from: string; effective_to: string | null; model: string; percentage: string | null; flat: string | null }>(
      SYSTEM,
      `select effective_from::text, effective_to::text, model::text, percentage::text, flat_weekly_amount::text as flat
       from public.carrier_fee_contracts where carrier_id = $1 order by effective_from`,
      [carrierId],
    );
  }

  it("ends the open contract the day the new terms start, without gaps or overlap", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(
        w.admin,
        `select public.replace_fee_contract($1, (select id from public.fee_plans where key = 'flat_weekly'), app.business_today() + 7, 'Signed amendment',
                'flat_weekly', null, 250.00, true, true, true, false)`,
        [w.A.carrierId],
      );
      const rows = await contracts(tx, w.A.carrierId);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.effective_to).toBe(rows[1]!.effective_from);
      expect(rows[1]).toMatchObject({ model: "flat_weekly", flat: "250.00", percentage: null, effective_to: null });
    });
  });

  it("refuses non-admins and start dates that do not follow the current terms", async () => {
    await rollbackTx(async (tx) => {
      const plan = `(select id from public.fee_plans where key = 'standard_percentage')`;
      await tx.rejects(w.dispatcherA, `select public.replace_fee_contract($1, ${plan}, app.business_today() + 7, 'x')`, [w.A.carrierId], /not permitted/);
      await tx.rejects(w.A.owner, `select public.replace_fee_contract($1, ${plan}, app.business_today() + 7, 'x')`, [w.A.carrierId], /not permitted/);
      await tx.rejects(w.admin, `select public.replace_fee_contract($1, ${plan}, app.business_today() - 90, 'x')`, [w.A.carrierId], /must start after/);
      expect(await contracts(tx, w.A.carrierId)).toHaveLength(1);
    });
  });

  it("is atomic: an invalid new contract keeps the current terms open", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(
        w.admin,
        `select public.replace_fee_contract($1, (select id from public.fee_plans where key = 'standard_percentage'), app.business_today() + 7, 'bad', 'percentage', 1.5)`,
        [w.A.carrierId],
      );
      const rows = await contracts(tx, w.A.carrierId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.effective_to).toBeNull();
    });
  });
});

describe("assign_dispatcher", () => {
  it("replaces the primary dispatcher and immediately widens the new dispatcher's access", async () => {
    await rollbackTx(async (tx) => {
      expect(await tx.count(w.dispatcherB, `select 1 from public.carriers where id = $1`, [w.A.carrierId])).toBe(0);
      await tx.query(w.admin, `select public.assign_dispatcher($1, $2, true, 'Coverage')`, [w.A.carrierId, w.dispatcherBId]);
      const rows = await tx.rows<{ dispatcher_id: string; is_primary: boolean }>(
        SYSTEM,
        `select dispatcher_id, is_primary from public.dispatcher_assignments where carrier_id = $1 and ended_at is null order by is_primary desc`,
        [w.A.carrierId],
      );
      expect(rows[0]).toEqual({ dispatcher_id: w.dispatcherBId, is_primary: true });
      expect(rows.filter((r) => r.is_primary)).toHaveLength(1);
      expect(await tx.count(w.dispatcherB, `select 1 from public.carriers where id = $1`, [w.A.carrierId])).toBe(1);
    });
  });

  it("only admins assign, and only staff can be assigned", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(w.dispatcherA, `select public.assign_dispatcher($1, $2, true)`, [w.A.carrierId, w.dispatcherAId], /not permitted/);
      await tx.rejects(w.admin, `select public.assign_dispatcher($1, $2, false)`, [w.A.carrierId, w.A.ownerId], /dispatcher or admin role/);
    });
  });
});

describe("list_staff_members", () => {
  it("lists active staff for staff callers only", async () => {
    await rollbackTx(async (tx) => {
      const staff = await tx.rows<{ user_id: string }>(w.dispatcherA, `select user_id from public.list_staff_members()`);
      expect(staff.map((s) => s.user_id)).toEqual(expect.arrayContaining([w.adminId, w.dispatcherAId, w.dispatcherBId]));
      expect(staff.map((s) => s.user_id)).not.toContain(w.A.ownerId);
      expect(await tx.count(w.A.owner, `select * from public.list_staff_members()`)).toBe(0);
      await tx.rejects(ANON, `select * from public.list_staff_members()`, [], /permission denied/);
    });
  });
});

describe("fee parity between TypeScript and the database", () => {
  const cases = [
    { pct: "0.0700", gross: "2100.00", detention: "0", tonu: "0", include: true },
    { pct: "0.0700", gross: "1999.99", detention: "150.00", tonu: "0", include: true },
    { pct: "0.0700", gross: "1999.99", detention: "150.00", tonu: "0", include: false },
    { pct: "0.0625", gross: "3333.33", detention: "75.55", tonu: "0", include: true },
    { pct: "0.0850", gross: "0.07", detention: "0", tonu: "0", include: true },
    { pct: "0.0550", gross: "12345.67", detention: "0.01", tonu: "0", include: true },
  ];

  it.each(cases)("$pct of $gross (+ detention $detention, included=$include)", async (c) => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `update public.carrier_fee_contracts set effective_to = app.business_today() where carrier_id = $1 and effective_to is null`, [w.A.carrierId]);
      await tx.query(
        SYSTEM,
        `insert into public.carrier_fee_contracts (carrier_id, fee_plan_id, model, percentage, include_detention, include_layover, include_tonu, include_other, effective_from)
         select $1, id, 'percentage', $2, $3, true, true, false, app.business_today() from public.fee_plans where key = 'standard_percentage'`,
        [w.A.carrierId, c.pct, c.include],
      );
      const { id } = await tx.one<{ id: string }>(
        w.dispatcherA,
        `select public.create_load($1::jsonb, $2::jsonb) as id`,
        [loadJson(w.A.carrierId, w.dispatcherAId, { gross_rate: c.gross }), stops],
      );
      if (Number(c.detention) > 0) {
        await tx.query(w.dispatcherA, `insert into public.load_charges (load_id, carrier_id, charge_type, amount) values ($1, $2, 'detention', $3)`, [id, w.A.carrierId, c.detention]);
        await tx.query(w.dispatcherA, `update public.loads set status_note = 'recalculate' where id = $1`, [id]);
      }
      const db = await tx.one<{ eligible: string; fee: string }>(SYSTEM, `select eligible_revenue::text as eligible, estimated_dispatch_fee::text as fee from public.loads where id = $1`, [id]);
      const ts = calculateLoadFee(
        { grossRate: c.gross, detention: c.detention },
        { model: "percentage", percentage: c.pct, flatWeeklyAmount: null, includeDetention: c.include, includeLayover: true, includeTonu: true, includeOther: false },
      );
      expect(db.eligible).toBe(centsToDecimal(ts.eligibleRevenue));
      expect(db.fee).toBe(centsToDecimal(ts.dispatchFee));
    });
  });
});

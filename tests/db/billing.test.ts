/**
 * Billing ledger tests: immutable fee snapshots, contract changes that do not
 * alter history, accessorial eligibility, TONU, idempotent weekly statements,
 * flat weekly fees, invoices and carrier-only payments.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVICE, SYSTEM, type Tx, closePool, rollbackTx } from "./support/harness";
import { type CarrierWorld, type World, createLoad, createWorld } from "./support/world";

let w: World;

beforeAll(async () => {
  w = await createWorld({ feePlanB: "flat_weekly" });
});
afterAll(closePool);

async function snapshotFor(tx: Tx, loadId: string) {
  return tx.one<Record<string, string>>(
    SYSTEM,
    `select basis, fee_model::text, fee_percentage::text, gross_rate::text, detention_total::text, total_revenue::text,
            eligible_revenue::text, dispatch_fee::text, statement_week::text
     from public.fee_snapshots where load_id = $1`,
    [loadId],
  );
}

async function replaceContract(tx: Tx, cw: CarrierWorld, terms: { percentage: string; includeDetention: boolean }) {
  await tx.query(
    SYSTEM,
    `update public.carrier_fee_contracts set effective_to = app.business_today() where carrier_id = $1 and effective_to is null`,
    [cw.carrierId],
  );
  await tx.query(
    SYSTEM,
    `insert into public.carrier_fee_contracts (carrier_id, fee_plan_id, model, percentage, include_detention, include_layover, include_tonu, include_other, effective_from)
     select $1, id, 'percentage', $2, $3, true, true, false, app.business_today() from public.fee_plans where key = 'standard_percentage'`,
    [cw.carrierId, terms.percentage, terms.includeDetention],
  );
}

describe("fee snapshots", () => {
  it("are created on completion with the contracted percentage of eligible revenue", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, {
        dispatcherId: w.dispatcherAId,
        advanceTo: "completed",
        charges: [{ type: "detention", amount: "150.00" }],
      });
      expect(await snapshotFor(tx, loadId)).toMatchObject({
        basis: "completed",
        fee_model: "percentage",
        fee_percentage: "0.0700",
        gross_rate: "2500.00",
        detention_total: "150.00",
        total_revenue: "2650.00",
        eligible_revenue: "2650.00",
        dispatch_fee: "185.50",
      });
    });
  });

  it("are immutable for every role", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed" });
      for (const actor of [w.superAdmin, SERVICE]) {
        await tx.rejects(actor, `update public.fee_snapshots set dispatch_fee = 0 where load_id = $1`, [loadId], /permission denied|append-only/);
        await tx.rejects(actor, `delete from public.fee_snapshots where load_id = $1`, [loadId], /permission denied|append-only/);
      }
      await tx.rejects(SYSTEM, `update public.fee_snapshots set dispatch_fee = 0 where load_id = $1`, [loadId], /append-only/);
      await tx.rejects(w.admin, `insert into public.fee_snapshots (load_id) values ($1)`, [loadId], /row-level security|null value/);
    });
  });

  it("do not change when pricing changes later", async () => {
    await rollbackTx(async (tx) => {
      const before = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed" });
      const original = await snapshotFor(tx, before);
      await replaceContract(tx, w.A, { percentage: "0.0500", includeDetention: true });
      expect(await snapshotFor(tx, before)).toEqual(original);
      const after = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed" });
      expect(await snapshotFor(tx, after)).toMatchObject({ fee_percentage: "0.0500", dispatch_fee: "125.00" });
    });
  });

  it("exclude accessorials when the contract excludes them", async () => {
    await rollbackTx(async (tx) => {
      await replaceContract(tx, w.A, { percentage: "0.0700", includeDetention: false });
      const loadId = await createLoad(tx, w.A, {
        dispatcherId: w.dispatcherAId,
        advanceTo: "completed",
        charges: [
          { type: "detention", amount: "200.00" },
          { type: "layover", amount: "100.00" },
          { type: "lumper_reimbursement", amount: "80.00" },
        ],
      });
      // eligible = 2500 + layover 100 (detention excluded, lumper never eligible)
      expect(await snapshotFor(tx, loadId)).toMatchObject({ total_revenue: "2800.00", eligible_revenue: "2600.00", dispatch_fee: "182.00" });
    });
  });

  it("TONU on a cancelled load creates a TONU snapshot", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "at_pickup" });
      await tx.query(w.dispatcherA, `insert into public.load_charges (load_id, carrier_id, charge_type, amount) values ($1, $2, 'tonu', 250)`, [
        loadId,
        w.A.carrierId,
      ]);
      await tx.query(w.dispatcherA, `update public.loads set status = 'cancelled', cancellation_reason = 'Shipper cancelled at dock' where id = $1`, [loadId]);
      expect(await snapshotFor(tx, loadId)).toMatchObject({ basis: "cancelled_tonu", gross_rate: "0.00", eligible_revenue: "250.00", dispatch_fee: "17.50" });
    });
  });

  it("fee contract terms are immutable and cannot overlap", async () => {
    await rollbackTx(async (tx) => {
      const { id } = await tx.one<{ id: string }>(SYSTEM, `select id from public.carrier_fee_contracts where carrier_id = $1`, [w.A.carrierId]);
      await tx.rejects(w.admin, `update public.carrier_fee_contracts set percentage = 0.01 where id = $1`, [id], /immutable/);
      await tx.rejects(
        w.admin,
        `insert into public.carrier_fee_contracts (carrier_id, fee_plan_id, effective_from)
         select $1, id, app.business_today() from public.fee_plans where key = 'flat_weekly'`,
        [w.A.carrierId],
        /no_overlap|conflicting key/,
      );
      await tx.rejects(w.dispatcherA, `insert into public.carrier_fee_contracts (carrier_id, fee_plan_id, effective_from) select $1, id, '2030-01-01' from public.fee_plans limit 1`, [w.A.carrierId], /row-level security/);
    });
  });
});

describe("weekly statements", () => {
  it("generation is idempotent and aggregates completed loads", async () => {
    await rollbackTx(async (tx) => {
      const l1 = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed", charges: [{ type: "detention", amount: "100.00" }] });
      await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed", gross: "1800.00" });
      const { week } = await tx.one<{ week: string }>(SYSTEM, `select statement_week::text as week from public.fee_snapshots where load_id = $1`, [l1]);
      const first = await tx.one<{ id: string }>(w.admin, `select public.generate_weekly_statement($1, $2::date) as id`, [w.A.carrierId, week]);
      const second = await tx.one<{ id: string }>(w.admin, `select public.generate_weekly_statement($1, $2::date) as id`, [w.A.carrierId, week]);
      expect(second.id).toBe(first.id);
      const s = await tx.one<Record<string, string | number>>(
        SYSTEM,
        `select loads_count, gross_load_revenue::text, additional_charges::text, eligible_revenue::text, dispatch_fee::text, amount_due::text, status::text
         from public.weekly_statements where id = $1`,
        [first.id],
      );
      // (2500 + 100) × 7% = 182.00 ; 1800 × 7% = 126.00
      expect(s).toEqual({
        loads_count: 2,
        gross_load_revenue: "4300.00",
        additional_charges: "100.00",
        eligible_revenue: "4400.00",
        dispatch_fee: "308.00",
        amount_due: "308.00",
        status: "draft",
      });
      const { n } = await tx.one<{ n: number }>(SYSTEM, `select count(*)::int as n from public.statement_line_items where statement_id = $1`, [first.id]);
      expect(n).toBe(2);
    });
  });

  it("flat weekly plans bill each active truck once per week", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.B, { dispatcherId: w.dispatcherBId, advanceTo: "completed" });
      expect(await snapshotFor(tx, loadId)).toMatchObject({ fee_model: "flat_weekly", dispatch_fee: "0.00" });
      const { week } = await tx.one<{ week: string }>(SYSTEM, `select statement_week::text as week from public.fee_snapshots where load_id = $1`, [loadId]);
      const { id } = await tx.one<{ id: string }>(SERVICE, `select public.generate_weekly_statement($1, $2::date) as id`, [w.B.carrierId, week]);
      await tx.one(SERVICE, `select public.generate_weekly_statement($1, $2::date) as id`, [w.B.carrierId, week]);
      const lines = await tx.rows<{ line_type: string; amount: string }>(
        SYSTEM,
        `select line_type, amount::text from public.statement_line_items where statement_id = $1 order by line_type`,
        [id],
      );
      expect(lines.filter((l) => l.line_type === "flat_weekly_fee")).toEqual([
        { line_type: "flat_weekly_fee", amount: "300.00" },
        { line_type: "flat_weekly_fee", amount: "300.00" },
      ]);
      const { amount_due } = await tx.one<{ amount_due: string }>(SYSTEM, `select amount_due::text from public.weekly_statements where id = $1`, [id]);
      expect(amount_due).toBe("600.00");
    });
  });

  it("credits adjust drafts; generated lines and totals cannot be edited by hand", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed" });
      const { week } = await tx.one<{ week: string }>(SYSTEM, `select statement_week::text as week from public.fee_snapshots where load_id = $1`, [loadId]);
      const { id } = await tx.one<{ id: string }>(w.admin, `select public.generate_weekly_statement($1, $2::date) as id`, [w.A.carrierId, week]);
      await tx.query(
        w.admin,
        `insert into public.statement_line_items (statement_id, carrier_id, line_type, description, amount) values ($1, $2, 'credit', 'Goodwill credit', -25.00)`,
        [id, w.A.carrierId],
      );
      const { amount_due } = await tx.one<{ amount_due: string }>(SYSTEM, `select amount_due::text from public.weekly_statements where id = $1`, [id]);
      expect(amount_due).toBe("150.00");
      await tx.rejects(
        w.admin,
        `insert into public.statement_line_items (statement_id, carrier_id, line_type, load_id, fee_snapshot_id, description, amount)
         select $1, carrier_id, 'load_fee', load_id, id, 'dup', 1 from public.fee_snapshots where load_id = $2`,
        [id, loadId],
        /only credits and adjustments/,
      );
      await tx.rejects(w.admin, `update public.weekly_statements set amount_due = 1 where id = $1`, [id], /computed from line items/);
      await tx.rejects(w.admin, `update public.weekly_statements set status = 'issued' where id = $1`, [id], /issue_weekly_statement/);
      await tx.rejects(w.dispatcherA, `select public.generate_weekly_statement($1, $2::date)`, [w.A.carrierId, week], /not permitted/);
      await tx.rejects(w.A.owner, `select public.generate_weekly_statement($1, $2::date)`, [w.A.carrierId, week], /not permitted/);
    });
  });

  it("issuing creates an open invoice; carriers see only issued statements and invoices", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed" });
      const { week } = await tx.one<{ week: string }>(SYSTEM, `select statement_week::text as week from public.fee_snapshots where load_id = $1`, [loadId]);
      const { id } = await tx.one<{ id: string }>(w.admin, `select public.generate_weekly_statement($1, $2::date) as id`, [w.A.carrierId, week]);
      expect(await tx.count(w.A.owner, `select 1 from public.weekly_statements where id = $1`, [id])).toBe(0);
      const { invoice } = await tx.one<{ invoice: string }>(w.admin, `select public.issue_weekly_statement($1, 10) as invoice`, [id]);
      const inv = await tx.one<Record<string, string>>(
        w.A.owner,
        `select status::text, total::text, balance_due::text, payer_type, (due_date - issue_date)::text as terms from public.invoices where id = $1`,
        [invoice],
      );
      expect(inv).toEqual({ status: "open", total: "175.00", balance_due: "175.00", payer_type: "carrier", terms: "10" });
      expect(await tx.count(w.A.owner, `select 1 from public.weekly_statements where id = $1 and status = 'issued'`, [id])).toBe(1);
      await tx.rejects(
        w.admin,
        `insert into public.statement_line_items (statement_id, carrier_id, line_type, description, amount) values ($1, $2, 'credit', 'late', -1)`,
        [id, w.A.carrierId],
        /issued statements cannot be changed/,
      );
      await tx.rejects(w.admin, `update public.weekly_statements set status = 'void', void_reason = 'x' where id = $1`, [id], /void the related invoice first/);
      // Re-running generation for an issued week is a no-op.
      const again = await tx.one<{ id: string }>(w.admin, `select public.generate_weekly_statement($1, $2::date) as id`, [w.A.carrierId, week]);
      expect(again.id).toBe(id);
    });
  });
});

describe("invoices and payments", () => {
  async function openInvoice(tx: Tx) {
    const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed" });
    const { week } = await tx.one<{ week: string }>(SYSTEM, `select statement_week::text as week from public.fee_snapshots where load_id = $1`, [loadId]);
    const { id } = await tx.one<{ id: string }>(w.admin, `select public.generate_weekly_statement($1, $2::date) as id`, [w.A.carrierId, week]);
    return (await tx.one<{ invoice: string }>(w.admin, `select public.issue_weekly_statement($1) as invoice`, [id])).invoice;
  }

  it("only the carrier can be the payer", async () => {
    await rollbackTx(async (tx) => {
      const invoice = await openInvoice(tx);
      await tx.rejects(
        w.admin,
        `insert into public.payments (invoice_id, carrier_id, amount, method, payer_type) values ($1, $2, 10, 'check', 'broker')`,
        [invoice, w.A.carrierId],
        /payments_payer_type_check/,
      );
      await tx.rejects(w.admin, `update public.invoices set payer_type = 'shipper' where id = $1`, [invoice], /invoices_payer_type_check/);
    });
  });

  it("manual payments settle invoices; overpayments and hand-marked paid are refused", async () => {
    await rollbackTx(async (tx) => {
      const invoice = await openInvoice(tx);
      await tx.rejects(w.admin, `update public.invoices set status = 'paid' where id = $1`, [invoice], /payment is recorded|computed/);
      await tx.rejects(w.admin, `update public.invoices set amount_paid = 175 where id = $1`, [invoice], /computed from line items and payments/);
      await tx.rejects(
        w.admin,
        `insert into public.payments (invoice_id, carrier_id, amount, method) values ($1, $2, 500, 'ach')`,
        [invoice, w.A.carrierId],
        /exceeds the balance/,
      );
      await tx.query(w.admin, `insert into public.payments (invoice_id, carrier_id, amount, method, reference) values ($1, $2, 100, 'ach', 'ACH-1')`, [
        invoice,
        w.A.carrierId,
      ]);
      let inv = await tx.one<{ status: string; balance_due: string }>(SYSTEM, `select status::text, balance_due::text from public.invoices where id = $1`, [invoice]);
      expect(inv).toEqual({ status: "open", balance_due: "75.00" });
      await tx.query(w.admin, `insert into public.payments (invoice_id, carrier_id, amount, method, reference) values ($1, $2, 75, 'check', 'CHK-9')`, [
        invoice,
        w.A.carrierId,
      ]);
      inv = await tx.one(SYSTEM, `select status::text, balance_due::text from public.invoices where id = $1`, [invoice]);
      expect(inv).toEqual({ status: "paid", balance_due: "0.00" });
    });
  });

  it("Stripe payments can only be recorded from the server (verified webhook)", async () => {
    await rollbackTx(async (tx) => {
      const invoice = await openInvoice(tx);
      const sql = `insert into public.payments (invoice_id, carrier_id, amount, method, stripe_event_id, stripe_payment_intent_id)
                   values ($1, $2, 175, 'stripe', $3, $4)`;
      await tx.rejects(w.admin, sql, [invoice, w.A.carrierId, "evt_admin", "pi_admin"], /verified Stripe events/);
      await tx.rejects(w.A.owner, sql, [invoice, w.A.carrierId, "evt_carrier", "pi_carrier"], /row-level security|verified Stripe events/);
      await tx.query(SERVICE, sql, [invoice, w.A.carrierId, "evt_1", "pi_1"]);
      // Replaying the same Stripe event is rejected (idempotency).
      await tx.rejects(SERVICE, sql, [invoice, w.A.carrierId, "evt_1", "pi_2"], /duplicate key|payments can only/);
      const { status } = await tx.one<{ status: string }>(w.A.owner, `select status::text from public.invoices where id = $1`, [invoice]);
      expect(status).toBe("paid");
    });
  });

  it("issued invoice lines and amounts are immutable", async () => {
    await rollbackTx(async (tx) => {
      const invoice = await openInvoice(tx);
      await tx.rejects(w.admin, `update public.invoice_line_items set unit_amount = 1 where invoice_id = $1`, [invoice], /immutable/);
      await tx.rejects(w.admin, `update public.invoices set total = 1 where id = $1`, [invoice], /computed|immutable/);
      await tx.rejects(w.admin, `delete from public.invoices where id = $1`, [invoice], /permission denied|append-only/);
    });
  });
});

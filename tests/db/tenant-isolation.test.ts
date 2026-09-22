/**
 * Negative authorization tests: one carrier can never read, change or create
 * another carrier's records, in any tenant-owned table. Also verifies a
 * dispatcher assigned only to carrier A is isolated from carrier B.
 */
import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM, closePool, commitTx, rollbackTx, type Actor, type Tx } from "./support/harness";
import { type CarrierWorld, type World, createLoad, createUser, createWorld } from "./support/world";

let w: World;

interface TenantTable {
  table: string;
  key: "carrier_id" | "id" | "organization_id";
  scope: "carrier" | "org";
  /** Which of the carrier's own users can see its rows in this table. */
  carrierVisible: "all" | "owner" | "none";
}

const TENANT_TABLES: TenantTable[] = [
  { table: "carriers", key: "id", scope: "carrier", carrierVisible: "all" },
  { table: "organizations", key: "id", scope: "org", carrierVisible: "all" },
  { table: "organization_members", key: "organization_id", scope: "org", carrierVisible: "all" },
  { table: "organization_invitations", key: "organization_id", scope: "org", carrierVisible: "owner" },
  { table: "dispatcher_assignments", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "trucks", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "trailers", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "drivers", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "driver_availability", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "lane_preferences", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "documents", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "agreement_acceptances", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "carrier_fee_contracts", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "loads", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "load_stops", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "load_vehicles", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "load_charges", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "load_notes", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "load_status_history", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "load_approvals", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "fee_snapshots", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "weekly_statements", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "statement_line_items", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "invoices", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "invoice_line_items", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "payments", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "support_requests", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "communications", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "carrier_applications", key: "carrier_id", scope: "carrier", carrierVisible: "all" },
  { table: "tasks", key: "carrier_id", scope: "carrier", carrierVisible: "none" },
];

function keyFor(t: TenantTable, cw: CarrierWorld) {
  return t.scope === "org" ? cw.orgId : cw.carrierId;
}

async function seedTenant(tx: Tx, cw: CarrierWorld, dispatcherId: string) {
  const completed = await createLoad(tx, cw, {
    dispatcherId,
    advanceTo: "completed",
    charges: [{ type: "detention", amount: "150.00" }],
  });
  await createLoad(tx, cw, { dispatcherId, advanceTo: "proposed" });
  await tx.query(
    SYSTEM,
    `insert into public.load_notes (load_id, carrier_id, visibility, body) values ($1, $2, 'carrier', 'Carrier-visible note')`,
    [completed, cw.carrierId],
  );
  await tx.query(
    SYSTEM,
    `insert into public.driver_availability (carrier_id, driver_id, truck_id, available_from, location_city, location_state)
     values ($1, $2, $3, now() - interval '1 hour', 'Dallas', 'TX')`,
    [cw.carrierId, cw.driverIds[1], cw.truckIds[1]],
  );
  await tx.query(SYSTEM, `insert into public.lane_preferences (carrier_id, preference, origin_state, destination_state) values ($1, 'preferred', 'TX', 'GA')`, [cw.carrierId]);
  await tx.query(SYSTEM, `insert into public.trailers (carrier_id, trailer_type, length_ft) values ($1, 'open_car_hauler', 53)`, [cw.carrierId]);
  await tx.query(
    SYSTEM,
    `insert into public.support_requests (carrier_id, category, subject, body) values ($1, 'general', 'Test request', 'Please call me')`,
    [cw.carrierId],
  );
  await tx.query(
    SYSTEM,
    `insert into public.communications (carrier_id, channel, direction, visibility, subject, status) values ($1, 'email', 'outbound', 'carrier', 'Welcome', 'sent')`,
    [cw.carrierId],
  );
  await tx.query(
    SYSTEM,
    `insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at)
     values ($1, $2, 'carrier_member', $3, now() + interval '7 days')`,
    [cw.orgId, `invitee-${randomUUID().slice(0, 6)}@test.example`, createHash("sha256").update(randomUUID()).digest("hex")],
  );
  await tx.query(SYSTEM, `insert into public.tasks (title, carrier_id, kind) values ('Follow up', $1, 'follow_up')`, [cw.carrierId]);
  await tx.query(
    SYSTEM,
    `insert into public.load_vehicles (load_id, carrier_id, vin, year, make, model, vehicle_type)
     select id, carrier_id, '1HGCM82633A004352', 2019, 'Honda', 'Accord', 'sedan'
     from public.loads where carrier_id = $1 and status = 'proposed' limit 1`,
    [cw.carrierId],
  );
  await tx.query(SYSTEM, `insert into public.carrier_applications (status, email, legal_name, carrier_id) values ('draft', 'x@test.example', 'x', $1)`, [cw.carrierId]);
  const { week } = await tx.one<{ week: string }>(
    SYSTEM,
    `select statement_week::text as week from public.fee_snapshots where load_id = $1`,
    [completed],
  );
  const { id: statementId } = await tx.one<{ id: string }>(SYSTEM, `select public.generate_weekly_statement($1, $2::date) as id`, [
    cw.carrierId,
    week,
  ]);
  const { invoice } = await tx.one<{ invoice: string }>(SYSTEM, `select public.issue_weekly_statement($1) as invoice`, [statementId]);
  await tx.query(
    SYSTEM,
    `insert into public.payments (invoice_id, carrier_id, amount, method, reference) values ($1, $2, 10.00, 'check', 'CHK-1')`,
    [invoice, cw.carrierId],
  );
}

beforeAll(async () => {
  w = await createWorld();
  await commitTx(async (tx) => {
    await seedTenant(tx, w.A, w.dispatcherAId);
    await seedTenant(tx, w.B, w.dispatcherBId);
  });
});

afterAll(closePool);

describe("fixtures are meaningful", () => {
  it.each(TENANT_TABLES)("carrier B has rows in $table", async (t) => {
    await rollbackTx(async (tx) => {
      const { n } = await tx.one<{ n: number }>(SYSTEM, `select count(*)::int as n from public.${t.table} where ${t.key} = $1`, [
        keyFor(t, w.B),
      ]);
      expect(n).toBeGreaterThan(0);
    });
  });
});

describe.each(TENANT_TABLES)("tenant isolation: $table", (t) => {
  const carrierActors = () => [
    ["owner", w.A.owner],
    ["member", w.A.member],
  ] as Array<["owner" | "member", Actor]>;

  it("carrier A users cannot read carrier B rows", async () => {
    await rollbackTx(async (tx) => {
      for (const [who, actor] of carrierActors()) {
        const other = await tx.one<{ n: number }>(actor, `select count(*)::int as n from public.${t.table} where ${t.key} = $1`, [
          keyFor(t, w.B),
        ]);
        expect(other.n).toBe(0);
        const own = await tx.one<{ n: number }>(actor, `select count(*)::int as n from public.${t.table} where ${t.key} = $1`, [
          keyFor(t, w.A),
        ]);
        const shouldSee = t.carrierVisible === "all" || (t.carrierVisible === "owner" && who === "owner");
        if (shouldSee) expect(own.n).toBeGreaterThan(0);
        else expect(own.n).toBe(0);
      }
    });
  });

  it("carrier A users cannot update or delete carrier B rows", async () => {
    await rollbackTx(async (tx) => {
      for (const [, actor] of carrierActors()) {
        for (const sql of [
          `update public.${t.table} set ${t.key} = ${t.key} where ${t.key} = $1`,
          `delete from public.${t.table} where ${t.key} = $1`,
        ]) {
          try {
            const affected = await tx.count(actor, sql, [keyFor(t, w.B)]);
            expect(affected).toBe(0);
          } catch (error) {
            // Privilege revoked or trigger refusal are also acceptable outcomes.
            expect(String(error)).toMatch(/permission denied|not permitted|immutable|append-only|violates|cannot/);
          }
        }
      }
    });
  });

  it("a dispatcher assigned only to carrier A cannot read carrier B rows", async () => {
    await rollbackTx(async (tx) => {
      const other = await tx.one<{ n: number }>(w.dispatcherA, `select count(*)::int as n from public.${t.table} where ${t.key} = $1`, [
        keyFor(t, w.B),
      ]);
      if (t.table === "carrier_applications") {
        // The application pipeline is shared by all staff; carrier records remain scoped.
        return;
      }
      expect(other.n).toBe(0);
    });
  });

  it("admins and all-carrier dispatchers can read both carriers", async () => {
    await rollbackTx(async (tx) => {
      for (const actor of [w.admin, w.dispatcherAll]) {
        for (const cw of [w.A, w.B]) {
          const { n } = await tx.one<{ n: number }>(actor, `select count(*)::int as n from public.${t.table} where ${t.key} = $1`, [
            keyFor(t, cw),
          ]);
          expect(n).toBeGreaterThan(0);
        }
      }
    });
  });
});

describe("carrier A cannot create records for carrier B", () => {
  const attempts: Array<[string, string, (b: CarrierWorld) => unknown[]]> = [
    ["trucks", `insert into public.trucks (carrier_id, unit_number, equipment_type) values ($1, 'X1', 'car_hauler')`, (b) => [b.carrierId]],
    ["drivers", `insert into public.drivers (carrier_id, full_name) values ($1, 'Intruder')`, (b) => [b.carrierId]],
    [
      "driver_availability",
      `insert into public.driver_availability (carrier_id, driver_id, available_from) values ($1, $2, now())`,
      (b) => [b.carrierId, b.driverIds[0]],
    ],
    ["lane_preferences", `insert into public.lane_preferences (carrier_id, preference, destination_state) values ($1, 'avoid', 'CA')`, (b) => [b.carrierId]],
    [
      "documents",
      `insert into public.documents (carrier_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
       values ($1::uuid, 'other', 'carriers/' || $1::text || '/x/file.pdf', 'file.pdf', 'application/pdf', 10)`,
      (b) => [b.carrierId],
    ],
    [
      "support_requests",
      `insert into public.support_requests (carrier_id, category, subject, body) values ($1, 'general', 'Hello', 'World')`,
      (b) => [b.carrierId],
    ],
    [
      "load_notes",
      `insert into public.load_notes (load_id, carrier_id, visibility, body, author_id)
       select id, carrier_id, 'carrier', 'note', auth.uid() from public.loads where carrier_id = $1 limit 1`,
      (b) => [b.carrierId],
    ],
    [
      "loads",
      `insert into public.loads (carrier_id, broker_name) values ($1, 'Broker')`,
      (b) => [b.carrierId],
    ],
    [
      "organization_invitations",
      `insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at, invited_by)
       values ($1, 'evil@test.example', 'carrier_member', repeat('a', 64), now() + interval '1 day', auth.uid())`,
      (b) => [b.orgId],
    ],
  ];

  it.each(attempts)("%s", async (_name, sql, params) => {
    await rollbackTx(async (tx) => {
      for (const actor of [w.A.owner, w.A.member]) {
        // Either RLS rejects the row or the statement inserts nothing (the
        // SELECT-based insert cannot see carrier B's loads).
        try {
          const n = await tx.count(actor, sql, params(w.B));
          expect(n).toBe(0);
        } catch (error) {
          expect(String(error)).toMatch(/row-level security|permission denied|not permitted/);
        }
      }
    });
  });
});

describe("unverified and removed users", () => {
  it("a member whose email is not verified sees no carrier data", async () => {
    await rollbackTx(async (tx) => {
      const id = await createUser(tx, "unverified", w.suffix, { confirmed: false });
      await tx.query(SYSTEM, `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'carrier_member')`, [
        w.A.orgId,
        id,
      ]);
      const actor: Actor = { kind: "user", id };
      const { n } = await tx.one<{ n: number }>(actor, `select count(*)::int as n from public.loads where carrier_id = $1`, [w.A.carrierId]);
      expect(n).toBe(0);
      const { c } = await tx.one<{ c: number }>(actor, `select count(*)::int as c from public.carriers`);
      expect(c).toBe(0);
    });
  });

  it("a removed member loses access immediately", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `update public.organization_members set status = 'removed' where user_id = $1`, [w.A.memberId]);
      const { n } = await tx.one<{ n: number }>(w.A.member, `select count(*)::int as n from public.trucks`);
      expect(n).toBe(0);
    });
  });

  it("anonymous API role cannot read any tenant table", async () => {
    await rollbackTx(async (tx) => {
      for (const t of TENANT_TABLES) {
        await tx.rejects({ kind: "anon" }, `select count(*) from public.${t.table}`, [], /permission denied/);
      }
    });
  });
});

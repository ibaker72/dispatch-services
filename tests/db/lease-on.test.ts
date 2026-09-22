/**
 * Lease-on operations stay disabled: the flag cannot be enabled until the
 * compliance checklist is complete, prepared tables are invisible to carriers
 * and read-only for admins while disabled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVICE, SYSTEM, type Tx, closePool, rollbackTx } from "./support/harness";
import { type World, createWorld } from "./support/world";

let w: World;

const PREPARED_TABLES = [
  "lease_on_applications",
  "authority_profiles",
  "owner_operator_leases",
  "carrier_insurance_policies",
  "driver_qualification_documents",
  "compliance_tasks",
  "vehicle_maintenance_records",
  "drug_testing_status",
  "clearinghouse_query_status",
  "eld_provider_connections",
  "settlement_deductions",
  "escrow_accounts",
  "safety_events",
];

beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

async function completeReadiness(tx: Tx) {
  const { id: versionId } = await tx.one<{ id: string }>(
    SYSTEM,
    `insert into public.agreement_versions (agreement_id, version, title, body_markdown, legal_review_status, attorney_approved_by_name, attorney_approved_at)
     select id, 'test-1', 'Lease', 'Attorney-approved lease text', 'attorney_approved', 'Test Counsel', now()
     from public.agreements where key = 'owner_operator_lease' returning id`,
  );
  await tx.query(
    w.superAdmin,
    `insert into public.authority_profiles (kind, legal_name, usdot_number, mc_number, authority_effective_date,
       insurance_filing_verified_at, boc3_verified_at, compliance_administrator_id, attorney_approved_lease_version_id)
     values ('company', 'Test Co', '1234567', '765432', current_date, now(), now(), $1, $2)
     on conflict (kind) do update set usdot_number = excluded.usdot_number, mc_number = excluded.mc_number,
       authority_effective_date = excluded.authority_effective_date, insurance_filing_verified_at = excluded.insurance_filing_verified_at,
       boc3_verified_at = excluded.boc3_verified_at, compliance_administrator_id = excluded.compliance_administrator_id,
       attorney_approved_lease_version_id = excluded.attorney_approved_lease_version_id`,
    [w.adminId, versionId],
  );
}

describe("lease-on feature flag", () => {
  it("is disabled by default", async () => {
    await rollbackTx(async (tx) => {
      const { enabled } = await tx.one<{ enabled: boolean }>(SYSTEM, `select enabled from public.feature_flags where key = 'lease_on_operations'`);
      expect(enabled).toBe(false);
    });
  });

  it("cannot be enabled by anyone while the checklist is incomplete", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `delete from public.authority_profiles`);
      for (const actor of [w.superAdmin, SERVICE, SYSTEM]) {
        await tx.rejects(actor, `update public.feature_flags set enabled = true where key = 'lease_on_operations'`, [], /compliance checklist/);
      }
      expect(await tx.count(w.admin, `update public.feature_flags set enabled = true where key = 'lease_on_operations'`)).toBe(0);
    });
  });

  it("reports each missing requirement", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `delete from public.authority_profiles`);
      const { readiness } = await tx.one<{ readiness: { ready: boolean; requirements: Record<string, boolean> } }>(
        w.admin,
        `select public.get_lease_on_readiness() as readiness`,
      );
      expect(readiness.ready).toBe(false);
      expect(Object.keys(readiness.requirements).sort()).toEqual(
        [
          "attorney_approved_lease_version",
          "authority_effective_date",
          "boc3_verified",
          "compliance_administrator",
          "insurance_filing_verified",
          "mc_number",
          "usdot_number",
        ].sort(),
      );
      expect(Object.values(readiness.requirements).every((v) => v === false)).toBe(true);
      await tx.rejects(w.A.owner, `select public.get_lease_on_readiness()`, [], /not permitted/);
      await tx.rejects(w.dispatcherA, `select public.get_lease_on_readiness()`, [], /not permitted/);
    });
  });

  it("a partially complete checklist still refuses activation", async () => {
    await rollbackTx(async (tx) => {
      await completeReadiness(tx);
      await tx.query(w.superAdmin, `update public.authority_profiles set boc3_verified_at = null`);
      await tx.rejects(w.superAdmin, `update public.feature_flags set enabled = true where key = 'lease_on_operations'`, [], /compliance checklist/);
    });
  });

  it("can be enabled by a super admin once every requirement exists", async () => {
    await rollbackTx(async (tx) => {
      await completeReadiness(tx);
      expect(await tx.count(w.superAdmin, `update public.feature_flags set enabled = true where key = 'lease_on_operations'`)).toBe(1);
      await tx.query(w.admin, `insert into public.compliance_tasks (title, area) values ('Verify BOC-3', 'authority')`);
    });
  });

  it("only super admins maintain the authority profile", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(w.admin, `insert into public.authority_profiles (kind, usdot_number) values ('company', '1')`, [], /row-level security/);
    });
  });
});

describe("prepared lease-on tables", () => {
  it.each(PREPARED_TABLES)("%s is invisible to carrier users and dispatchers", async (table) => {
    await rollbackTx(async (tx) => {
      for (const actor of [w.A.owner, w.A.member, w.dispatcherA]) {
        const { n } = await tx.one<{ n: number }>(actor, `select count(*)::int as n from public.${table}`);
        expect(n).toBe(0);
      }
    });
  });

  it("admins cannot write to prepared tables while lease-on is disabled", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(w.admin, `insert into public.compliance_tasks (title, area) values ('x', 'other')`, [], /row-level security/);
      await tx.rejects(w.superAdmin, `insert into public.safety_events (event_type) values ('inspection')`, [], /row-level security/);
      await tx.rejects(w.admin, `insert into public.lease_on_applications (full_name, email) values ('x', 'x@test.example')`, [], /row-level security/);
    });
  });

  it("the public waitlist is written by the server only and read by admins only", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects({ kind: "anon" }, `insert into public.lease_on_waitlist (full_name, email, consent_at) values ('A', 'a@test.example', now())`, [], /permission denied/);
      await tx.rejects(w.A.owner, `insert into public.lease_on_waitlist (full_name, email, consent_at) values ('A', 'a@test.example', now())`, [], /row-level security/);
      await tx.query(SERVICE, `insert into public.lease_on_waitlist (full_name, email, consent_at) values ('Waitlist Person', 'wl@test.example', now())`);
      expect(await tx.count(w.A.owner, `select 1 from public.lease_on_waitlist`)).toBe(0);
      expect(await tx.count(w.admin, `select 1 from public.lease_on_waitlist where email = 'wl@test.example'`)).toBe(1);
    });
  });
});

/**
 * Application approval, portal invitation acceptance, the onboarding
 * checklist that gates activation, carrier cancellation requests and
 * dispatcher-scoped dashboard metrics.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVICE, SYSTEM, type Tx, closePool, rollbackTx, user } from "./support/harness";
import { type World, createLoad, createUser, createWorld, insertDocument } from "./support/world";

let w: World;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

const FORM_DATA = {
  contact: { fullName: "Pat Applicant", email: "pat@applicant.example", phone: "555-0199" },
  business: {
    legalName: "Applicant Hauling LLC",
    dbaName: "AH",
    mcNumber: "1234567",
    usdotNumber: "7654321",
    einLast4: "4321",
    yearsInBusiness: 3,
    authorityActiveDate: "2023-01-15",
    addressLine1: "1 Main St",
    city: "Tulsa",
    state: "ok",
    postalCode: "74103",
  },
  equipment: {
    primaryEquipmentType: "car_hauler",
    trucks: [
      { unitNumber: "7", equipmentType: "car_hauler", year: 2021, make: "Ram", model: "5500", vehicleCapacity: 3 },
      { unitNumber: "", equipmentType: "hotshot" },
    ],
    trailers: [{ trailerType: "wedge", lengthFt: 40, vehicleCapacity: 3 }],
  },
  drivers: { drivers: [{ fullName: "Pat Applicant", phone: "555-0199", isOwnerOperator: true }] },
  lanes: {
    homeBaseCity: "Tulsa",
    homeBaseState: "OK",
    preferredStates: ["TX", "ok"],
    avoidStates: ["NY"],
    preferredLanes: [{ originState: "OK", destinationState: "GA" }],
  },
  preferences: { minRatePerMile: 2.25, desiredWeeklyGross: 8000, daysAvailable: ["mon", "tue", "wed"], maxDeadheadMiles: 150 },
  factoring: { status: "factoring", companyName: "Example Factoring Co" },
  documents: { insuranceExpirationDate: "2030-12-31" },
};

async function submittedApplication(tx: Tx): Promise<string> {
  const { id } = await tx.one<{ id: string }>(
    SERVICE,
    `insert into public.carrier_applications (status, email, contact_name, legal_name, dba_name, mc_number, usdot_number,
       primary_equipment_type, truck_count, form_data, consent_version, consent_accepted_at, submitted_at)
     values ('draft', 'pat@applicant.example', 'Pat Applicant', 'Applicant Hauling LLC', 'AH', '1234567', '7654321',
       'car_hauler', 2, $1::jsonb, 'v1', now(), now()) returning id`,
    [JSON.stringify(FORM_DATA)],
  );
  await tx.query(SERVICE, `update public.carrier_applications set status = 'submitted' where id = $1`, [id]);
  await tx.query(
    SERVICE,
    `insert into public.documents (application_id, doc_type, status, storage_path, original_filename, mime_type, size_bytes)
     values ($1::uuid, 'w9', 'pending_review', 'applications/' || $1::text || '/d1/w9.pdf', 'w9.pdf', 'application/pdf', 1000)`,
    [id],
  );
  return id;
}

describe("application lifecycle", () => {
  it("rejects invalid status transitions", async () => {
    await rollbackTx(async (tx) => {
      const id = await submittedApplication(tx);
      await tx.rejects(w.admin, `update public.carrier_applications set status = 'active' where id = $1`, [id], /invalid application status transition/);
      await tx.query(w.admin, `update public.carrier_applications set status = 'information_requested', information_request = 'Please upload COI' where id = $1`, [id]);
      await tx.rejects(w.admin, `update public.carrier_applications set status = 'approved' where id = $1`, [id], /invalid application status transition/);
    });
  });

  it("dispatchers and carriers cannot change application decisions", async () => {
    await rollbackTx(async (tx) => {
      const id = await submittedApplication(tx);
      expect(await tx.count(w.dispatcherA, `update public.carrier_applications set status = 'declined' where id = $1`, [id])).toBe(0);
      await tx.rejects(w.dispatcherA, `select public.approve_application($1)`, [id], /not permitted/);
      await tx.rejects(w.A.owner, `select public.approve_application($1)`, [id], /not permitted/);
    });
  });

  it("approval creates the carrier, fleet, lanes and fee contract atomically", async () => {
    await rollbackTx(async (tx) => {
      const id = await submittedApplication(tx);
      const { carrier } = await tx.one<{ carrier: string }>(w.admin, `select public.approve_application($1, null, $2, 'Looks good') as carrier`, [
        id,
        w.dispatcherAId,
      ]);
      const c = await tx.one<Record<string, unknown>>(
        SYSTEM,
        `select legal_name, status::text, state, ein_last4, factoring_status, factoring_company_name, days_available,
                min_rate_per_mile::text, insurance_expiration_date::text
         from public.carriers where id = $1`,
        [carrier],
      );
      expect(c).toEqual({
        legal_name: "Applicant Hauling LLC",
        status: "onboarding",
        state: "OK",
        ein_last4: "4321",
        factoring_status: "factoring",
        factoring_company_name: "Example Factoring Co",
        days_available: ["mon", "tue", "wed"],
        min_rate_per_mile: "2.25",
        insurance_expiration_date: "2030-12-31",
      });
      const trucks = await tx.rows<{ unit_number: string; equipment_type: string }>(
        SYSTEM,
        `select unit_number, equipment_type from public.trucks where carrier_id = $1 order by unit_number`,
        [carrier],
      );
      expect(trucks).toEqual([
        { unit_number: "7", equipment_type: "car_hauler" },
        { unit_number: "Truck 2", equipment_type: "hotshot" },
      ]);
      const lanes = await tx.rows<{ preference: string; origin_state: string | null; destination_state: string }>(
        SYSTEM,
        `select preference, origin_state, destination_state from public.lane_preferences where carrier_id = $1 order by preference, destination_state`,
        [carrier],
      );
      expect(lanes).toHaveLength(4);
      const contract = await tx.one<{ model: string; percentage: string }>(
        SYSTEM,
        `select model::text, percentage::text from public.carrier_fee_contracts where carrier_id = $1`,
        [carrier],
      );
      expect(contract).toEqual({ model: "percentage", percentage: "0.0700" });
      const doc = await tx.one<{ carrier_id: string }>(SYSTEM, `select carrier_id from public.documents where application_id = $1`, [id]);
      expect(doc.carrier_id).toBe(carrier);
      const app = await tx.one<{ status: string; carrier_id: string }>(SYSTEM, `select status::text, carrier_id from public.carrier_applications where id = $1`, [id]);
      expect(app).toEqual({ status: "approved", carrier_id: carrier });
      await tx.rejects(w.admin, `select public.approve_application($1)`, [id], /only submitted applications/);
    });
  });
});

describe("invitations and onboarding", () => {
  async function approvedCarrier(tx: Tx) {
    const id = await submittedApplication(tx);
    const { carrier } = await tx.one<{ carrier: string }>(w.admin, `select public.approve_application($1) as carrier`, [id]);
    const { organization_id } = await tx.one<{ organization_id: string }>(SYSTEM, `select organization_id from public.carriers where id = $1`, [carrier]);
    return { applicationId: id, carrierId: carrier, orgId: organization_id };
  }

  async function invite(tx: Tx, orgId: string, email: string, expiresInterval = "7 days") {
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    await tx.query(
      w.admin,
      `insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at, invited_by)
       values ($1, $2, 'carrier_owner', $3, now() + $4::interval, $5)`,
      [orgId, email, hash, expiresInterval, w.adminId],
    );
    return token;
  }

  it("accepting an invitation creates the owner membership and moves the application to onboarding", async () => {
    await rollbackTx(async (tx) => {
      const { orgId, applicationId, carrierId } = await approvedCarrier(tx);
      const ownerId = await createUser(tx, "invited-owner", w.suffix);
      const email = `invited-owner-${w.suffix}@test.example`;
      const token = await invite(tx, orgId, email);
      await tx.query(user(ownerId), `select public.accept_organization_invitation($1)`, [token]);
      const m = await tx.one<{ role: string }>(SYSTEM, `select role::text from public.organization_members where user_id = $1`, [ownerId]);
      expect(m.role).toBe("carrier_owner");
      const app = await tx.one<{ status: string }>(SYSTEM, `select status::text from public.carrier_applications where id = $1`, [applicationId]);
      expect(app.status).toBe("onboarding");
      expect(await tx.count(user(ownerId), `select 1 from public.carriers where id = $1`, [carrierId])).toBe(1);
      // Replaying the token by someone else fails.
      const other = await createUser(tx, "someone-else", w.suffix);
      await tx.rejects(user(other), `select public.accept_organization_invitation($1)`, [token], /already used/);
    });
  });

  it("invitations are bound to the invited email and expire", async () => {
    await rollbackTx(async (tx) => {
      const { orgId } = await approvedCarrier(tx);
      const wrong = await createUser(tx, "wrong-person", w.suffix);
      const token = await invite(tx, orgId, `invited-owner-${w.suffix}@test.example`);
      await tx.rejects(user(wrong), `select public.accept_organization_invitation($1)`, [token], /different email/);
      const late = await createUser(tx, "late-person", w.suffix);
      const expired = await invite(tx, orgId, `late-person-${w.suffix}@test.example`);
      await tx.query(
        SYSTEM,
        `update public.organization_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
         where email = $1`,
        [`late-person-${w.suffix}@test.example`],
      );
      await tx.rejects(user(late), `select public.accept_organization_invitation($1)`, [expired], /invitation expired/);
      await tx.rejects({ kind: "anon" }, `select public.accept_organization_invitation($1)`, [token], /permission denied/);
    });
  });

  it("activation is refused until every onboarding step is complete", async () => {
    await rollbackTx(async (tx) => {
      const { carrierId, orgId } = await approvedCarrier(tx);
      await tx.rejects(w.admin, `update public.carriers set status = 'active' where id = $1`, [carrierId], /onboarding is incomplete/);
      const incomplete = await tx.one<{ result: { complete: boolean; steps: Array<{ key: string; complete: boolean }> } }>(
        w.admin,
        `select public.get_carrier_onboarding($1) as result`,
        [carrierId],
      );
      expect(incomplete.result.complete).toBe(false);
      const keys = incomplete.result.steps.map((s) => s.key);
      expect(keys).toEqual(
        expect.arrayContaining([
          "application_approved",
          "account_invitation",
          "agreement:dispatch_service_agreement",
          "agreement:broker_authorization",
          "document:w9",
          "document:certificate_of_insurance",
          "document:operating_authority",
          "insurance_current",
          "authority_verified",
          "factoring",
          "dispatcher_assigned",
          "fleet_setup",
          "fee_contract",
        ]),
      );

      // Complete each step the way the product does.
      const ownerId = await createUser(tx, "onboard-owner", w.suffix);
      const token = await invite(tx, orgId, `onboard-owner-${w.suffix}@test.example`);
      await tx.query(user(ownerId), `select public.accept_organization_invitation($1)`, [token]);
      await tx.query(
        SERVICE,
        `insert into public.agreement_acceptances (agreement_version_id, carrier_id, user_id, signer_name, document_hash)
         select v.id, $1, $2, 'Onboard Owner', v.body_sha256 from public.agreement_versions v join public.agreements a on a.id = v.agreement_id
         where a.required_for_activation and a.audience = 'carrier' and v.status = 'published'`,
        [carrierId, ownerId],
      );
      await tx.query(SYSTEM, `update public.documents set status = 'accepted' where carrier_id = $1 and doc_type = 'w9'`, [carrierId]);
      await insertDocument(tx, carrierId, "certificate_of_insurance", { expiresOn: "2030-12-31" });
      await insertDocument(tx, carrierId, "operating_authority");
      await tx.query(w.admin, `update public.carriers set authority_verification_status = 'verified' where id = $1`, [carrierId]);
      await tx.query(w.admin, `insert into public.dispatcher_assignments (carrier_id, dispatcher_id, is_primary) values ($1, $2, true)`, [
        carrierId,
        w.dispatcherAId,
      ]);
      await tx.query(w.admin, `insert into public.drivers (carrier_id, full_name) values ($1, 'Second Driver')`, [carrierId]);

      const done = await tx.one<{ result: { complete: boolean; steps: Array<{ key: string; complete: boolean }> } }>(
        w.admin,
        `select public.get_carrier_onboarding($1) as result`,
        [carrierId],
      );
      expect(done.result.steps.filter((s) => !s.complete)).toEqual([]);
      await tx.query(w.admin, `update public.carriers set status = 'active' where id = $1`, [carrierId]);
      const app = await tx.one<{ status: string }>(SYSTEM, `select a.status::text from public.carrier_applications a where a.carrier_id = $1`, [carrierId]);
      expect(app.status).toBe("active");
      await tx.rejects(ownerId ? user(ownerId) : SYSTEM, `select public.get_carrier_onboarding($1)`, [w.B.carrierId], /carrier not found/);
    });
  });
});

describe("cancellation requests", () => {
  it("owners can request cancellation with the agreement's notice period; members cannot", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(w.A.member, `select public.request_carrier_cancellation($1, 'Switching providers')`, [w.A.carrierId], /carrier not found/);
      await tx.rejects(w.A.owner, `select public.request_carrier_cancellation($1, 'Switching providers')`, [w.B.carrierId], /carrier not found/);
      const { effective } = await tx.one<{ effective: string }>(
        w.A.owner,
        `select public.request_carrier_cancellation($1, 'Switching providers')::text as effective`,
        [w.A.carrierId],
      );
      const expected = await tx.one<{ d: string }>(SYSTEM, `select (app.business_today() + 14)::text as d`);
      expect(effective).toBe(expected.d);
      const { n } = await tx.one<{ n: number }>(
        w.A.owner,
        `select count(*)::int as n from public.support_requests where carrier_id = $1 and category = 'cancellation'`,
        [w.A.carrierId],
      );
      expect(n).toBe(1);
      // Idempotent
      const again = await tx.one<{ effective: string }>(
        w.A.owner,
        `select public.request_carrier_cancellation($1, 'again')::text as effective`,
        [w.A.carrierId],
      );
      expect(again.effective).toBe(effective);
    });
  });
});

describe("dashboard metrics", () => {
  it("are scoped by RLS: dispatchers see only their carriers; carriers cannot call them", async () => {
    await rollbackTx(async (tx) => {
      await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "completed" });
      await createLoad(tx, w.B, { dispatcherId: w.dispatcherBId, advanceTo: "completed", gross: "4000.00" });
      const mine = await tx.one<{ m: Record<string, number> }>(w.dispatcherA, `select public.get_dashboard_metrics() as m`);
      const all = await tx.one<{ m: Record<string, number> }>(w.admin, `select public.get_dashboard_metrics() as m`);
      expect(Number(mine.m.carrier_gross_revenue)).toBeLessThan(Number(all.m.carrier_gross_revenue));
      expect(Number(mine.m.dispatch_fees_earned)).toBeGreaterThan(0);
      expect(Number(all.m.active_carriers)).toBeGreaterThanOrEqual(2);
      expect(Number(mine.m.active_carriers)).toBe(1);
      await tx.rejects(w.A.owner, `select public.get_dashboard_metrics()`, [], /not permitted/);
    });
  });
});

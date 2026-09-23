/**
 * Test fixtures built through the real schema (triggers and guards run), so a
 * fixture that violates a business rule fails loudly instead of hiding bugs.
 */
import { randomUUID } from "node:crypto";
import { SYSTEM, type Actor, type Tx, commitTx, user } from "./harness";

export type LoadStatus =
  | "opportunity"
  | "proposed"
  | "approved"
  | "booked"
  | "dispatched"
  | "at_pickup"
  | "loaded"
  | "in_transit"
  | "delivered"
  | "paperwork_pending"
  | "completed";

export const LOAD_PATH: LoadStatus[] = [
  "opportunity",
  "proposed",
  "approved",
  "booked",
  "dispatched",
  "at_pickup",
  "loaded",
  "in_transit",
  "delivered",
  "paperwork_pending",
  "completed",
];

export interface CarrierWorld {
  label: string;
  carrierId: string;
  orgId: string;
  ownerId: string;
  memberId: string;
  truckIds: string[];
  driverIds: string[];
  owner: Actor;
  member: Actor;
}

export interface World {
  suffix: string;
  superAdminId: string;
  adminId: string;
  dispatcherAId: string;
  dispatcherBId: string;
  dispatcherAllId: string;
  superAdmin: Actor;
  admin: Actor;
  dispatcherA: Actor;
  dispatcherB: Actor;
  dispatcherAll: Actor;
  A: CarrierWorld;
  B: CarrierWorld;
}

export async function createUser(
  tx: Tx,
  label: string,
  suffix: string,
  opts: { confirmed?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    SYSTEM,
    // Token columns must be '' (not NULL) or GoTrue's admin user listing fails on these rows.
    `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at,
                             confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
                             phone_change, phone_change_token, reauthentication_token)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, $4::jsonb, '{}'::jsonb, now(), now(),
             '', '', '', '', '', '', '', '')`,
    [id, `${label}-${suffix}@test.example`, opts.confirmed === false ? null : new Date(), JSON.stringify({ full_name: label })],
  );
  return id;
}

export async function grantStaff(tx: Tx, userId: string, role: "super_admin" | "admin" | "dispatcher", grantsAll = false) {
  await tx.query(SYSTEM, `insert into public.user_roles (user_id, role, grants_all_carriers) values ($1, $2, $3)`, [
    userId,
    role,
    grantsAll,
  ]);
}

export async function ensurePublishedAgreements(tx: Tx) {
  await tx.query(SYSTEM, "select pg_advisory_xact_lock(4242)");
  await tx.query(
    SYSTEM,
    `update public.agreement_versions v set status = 'published'
     from public.agreements a
     where a.id = v.agreement_id and a.key in ('dispatch_service_agreement', 'broker_authorization')
       and v.status = 'draft'
       and not exists (select 1 from public.agreement_versions p where p.agreement_id = a.id and p.status = 'published')`,
  );
}

export async function insertDocument(
  tx: Tx,
  carrierId: string,
  docType: string,
  opts: { status?: string; loadId?: string; expiresOn?: string | null; visibility?: string; uploadedBy?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  const path = `carriers/${carrierId}/${id}/${docType}.pdf`;
  await tx.query(
    SYSTEM,
    `insert into public.documents (id, carrier_id, load_id, doc_type, status, storage_path, original_filename, mime_type, size_bytes, expires_on, visibility, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, 'application/pdf', 2048, $8, $9, $10)`,
    [
      id,
      carrierId,
      opts.loadId ?? null,
      docType,
      opts.status ?? "accepted",
      path,
      `${docType}.pdf`,
      opts.expiresOn ?? null,
      opts.visibility ?? "carrier",
      opts.uploadedBy ?? null,
    ],
  );
  await tx.query(SYSTEM, `insert into storage.objects (bucket_id, name) values ('carrier-documents', $1)`, [path]);
  return id;
}

export async function createCarrier(
  tx: Tx,
  label: string,
  suffix: string,
  opts: { dispatcherId: string; feePlanKey?: string; activate?: boolean },
): Promise<CarrierWorld> {
  const ownerId = await createUser(tx, `${label}-owner`, suffix);
  const memberId = await createUser(tx, `${label}-member`, suffix);
  const { id: orgId } = await tx.one<{ id: string }>(
    SYSTEM,
    `insert into public.organizations (name) values ($1) returning id`,
    [`${label} Test Carrier LLC`],
  );
  const { id: carrierId } = await tx.one<{ id: string }>(
    SYSTEM,
    `insert into public.carriers (organization_id, legal_name, mc_number, usdot_number, factoring_status,
                                  authority_verification_status, insurance_expiration_date, email)
     values ($1, $2, $3, $4, 'none', 'verified', app.business_today() + 365, $5) returning id`,
    [orgId, `${label} Test Carrier LLC`, `TEST-${label}`, `TEST-${label}`, `${label}-${suffix}@carrier.example`],
  );
  await tx.query(
    SYSTEM,
    `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'carrier_owner'), ($1, $3, 'carrier_member')`,
    [orgId, ownerId, memberId],
  );
  await tx.query(
    SYSTEM,
    `insert into public.carrier_fee_contracts (carrier_id, fee_plan_id, effective_from)
     select $1, id, app.business_today() - 60 from public.fee_plans where key = $2`,
    [carrierId, opts.feePlanKey ?? "standard_percentage"],
  );
  await tx.query(
    SYSTEM,
    `insert into public.dispatcher_assignments (carrier_id, dispatcher_id, is_primary) values ($1, $2, true)`,
    [carrierId, opts.dispatcherId],
  );
  const trucks = await tx.rows<{ id: string }>(
    SYSTEM,
    `insert into public.trucks (carrier_id, unit_number, equipment_type, vehicle_capacity)
     values ($1, '101', 'car_hauler', 3), ($1, '102', 'car_hauler', 3) returning id`,
    [carrierId],
  );
  const drivers = await tx.rows<{ id: string }>(
    SYSTEM,
    `insert into public.drivers (carrier_id, full_name, phone) values ($1, 'Driver One', '555-0100'), ($1, 'Driver Two', '555-0101') returning id`,
    [carrierId],
  );
  await tx.query(
    SYSTEM,
    `insert into public.agreement_acceptances (agreement_version_id, carrier_id, user_id, signer_name, document_hash)
     select v.id, $1, $2, 'Test Owner', v.body_sha256
     from public.agreement_versions v join public.agreements a on a.id = v.agreement_id
     where a.required_for_activation and a.active and a.audience = 'carrier' and v.status = 'published'`,
    [carrierId, ownerId],
  );
  const requirements = await tx.rows<{ doc_type: string; tracks_expiration: boolean }>(
    SYSTEM,
    `select doc_type, tracks_expiration from public.document_requirements
     where active and applies_to = 'carrier' and required_for_activation`,
  );
  for (const r of requirements) {
    await insertDocument(tx, carrierId, r.doc_type, {
      expiresOn: r.tracks_expiration ? new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10) : null,
    });
  }
  if (opts.activate !== false) {
    await tx.query(SYSTEM, `update public.carriers set status = 'active' where id = $1`, [carrierId]);
  }
  return {
    label,
    carrierId,
    orgId,
    ownerId,
    memberId,
    truckIds: trucks.map((t) => t.id),
    driverIds: drivers.map((d) => d.id),
    owner: user(ownerId),
    member: user(memberId),
  };
}

export async function createWorld(opts: { feePlanB?: string } = {}): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  return commitTx(async (tx) => {
    await ensurePublishedAgreements(tx);
    const superAdminId = await createUser(tx, "superadmin", suffix);
    const adminId = await createUser(tx, "admin", suffix);
    const dispatcherAId = await createUser(tx, "dispatcher-a", suffix);
    const dispatcherBId = await createUser(tx, "dispatcher-b", suffix);
    const dispatcherAllId = await createUser(tx, "dispatcher-all", suffix);
    await grantStaff(tx, superAdminId, "super_admin");
    await grantStaff(tx, adminId, "admin");
    await grantStaff(tx, dispatcherAId, "dispatcher");
    await grantStaff(tx, dispatcherBId, "dispatcher");
    await grantStaff(tx, dispatcherAllId, "dispatcher", true);
    const A = await createCarrier(tx, "alpha", suffix, { dispatcherId: dispatcherAId });
    const B = await createCarrier(tx, "bravo", suffix, {
      dispatcherId: dispatcherBId,
      feePlanKey: opts.feePlanB ?? "standard_percentage",
    });
    return {
      suffix,
      superAdminId,
      adminId,
      dispatcherAId,
      dispatcherBId,
      dispatcherAllId,
      superAdmin: user(superAdminId),
      admin: user(adminId),
      dispatcherA: user(dispatcherAId),
      dispatcherB: user(dispatcherBId),
      dispatcherAll: user(dispatcherAllId),
      A,
      B,
    };
  });
}

export interface LoadOptions {
  dispatcherId: string;
  gross?: string;
  loadedMiles?: string;
  deadheadMiles?: string;
  advanceTo?: LoadStatus;
  charges?: Array<{ type: string; amount: string }>;
}

/** Creates a load through the real workflow, advancing it status by status. */
export async function createLoad(tx: Tx, cw: CarrierWorld, opts: LoadOptions): Promise<string> {
  const { id } = await tx.one<{ id: string }>(
    SYSTEM,
    `insert into public.loads (carrier_id, dispatcher_id, broker_name, broker_mc_number, commodity, weight_lbs,
                               gross_rate, loaded_miles, deadhead_miles, equipment_type)
     values ($1, $2, 'Example Logistics Brokerage', '000000', 'Used vehicles', 12000, $3, $4, $5, 'car_hauler')
     returning id`,
    [cw.carrierId, opts.dispatcherId, opts.gross ?? "2500.00", opts.loadedMiles ?? "1000.0", opts.deadheadMiles ?? "100.0"],
  );
  await tx.query(
    SYSTEM,
    `insert into public.load_stops (load_id, carrier_id, sequence, stop_type, city, state, window_start, window_end)
     values ($1, $2, 1, 'pickup', 'Dallas', 'TX', now() + interval '1 day', now() + interval '1 day 2 hours'),
            ($1, $2, 2, 'delivery', 'Atlanta', 'GA', now() + interval '3 days', now() + interval '3 days 4 hours')`,
    [id, cw.carrierId],
  );
  for (const charge of opts.charges ?? []) {
    await tx.query(
      SYSTEM,
      `insert into public.load_charges (load_id, carrier_id, charge_type, amount) values ($1, $2, $3, $4)`,
      [id, cw.carrierId, charge.type, charge.amount],
    );
  }
  const target = opts.advanceTo ?? "opportunity";
  for (const status of LOAD_PATH.slice(1, LOAD_PATH.indexOf(target) + 1)) {
    await advanceLoad(tx, cw, id, status, opts.dispatcherId);
  }
  return id;
}

export async function advanceLoad(tx: Tx, cw: CarrierWorld, loadId: string, status: LoadStatus, dispatcherId: string) {
  if (status === "approved") {
    await tx.query(
      SYSTEM,
      `insert into public.load_approvals (load_id, carrier_id, decision, method, approver_name, recorded_by, approved_gross_rate, note)
       select id, carrier_id, 'approved', 'phone', 'Test Owner', $2, gross_rate, 'Owner approved by phone during test setup'
       from public.loads where id = $1`,
      [loadId, dispatcherId],
    );
  }
  if (status === "booked") {
    await tx.query(SYSTEM, `update public.loads set truck_id = $2, driver_id = $3 where id = $1`, [
      loadId,
      cw.truckIds[0],
      cw.driverIds[0],
    ]);
  }
  if (status === "completed") {
    for (const docType of ["rate_confirmation", "bill_of_lading", "proof_of_delivery"]) {
      await insertDocument(tx, cw.carrierId, docType, { loadId, status: "pending_review" });
    }
  }
  await tx.query(SYSTEM, `update public.loads set status = $2 where id = $1`, [loadId, status]);
}

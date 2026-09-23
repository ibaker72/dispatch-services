/**
 * Demo seed — clearly fictional data for local development and E2E tests.
 *
 *   pnpm seed            (uses .env.local / .local-stack/env)
 *
 * Creates: one super admin, one dispatcher, two isolated demo carriers with
 * owners, trucks, drivers, documents, accepted agreements, loads in several
 * workflow states, a weekly statement, invoices and a payment.
 *
 * Safety: refuses to run when APP_ENV=production, and refuses non-local
 * Supabase URLs unless --allow-remote is passed (e.g. a staging project).
 * All emails use the reserved .example domain; all names say "Demo".
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/db/database.types";
import { weekStart } from "../src/lib/domain/dates";
import { loadLocalStackEnv } from "../tests/support/env";

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
}
loadDotEnv(path.join(process.cwd(), ".env.local"));
loadLocalStackEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (process.env.APP_ENV === "production") throw new Error("Refusing to seed demo data into production (APP_ENV=production).");
if (!/127\.0\.0\.1|localhost/.test(url) && !process.argv.includes("--allow-remote")) {
  throw new Error(`Refusing to seed a non-local Supabase project (${url}). Pass --allow-remote for a staging/dev project.`);
}

const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const TZ = "America/Chicago";

export const DEMO_USERS = {
  admin: { email: "admin@demo.example", password: "DemoAdmin!2026", name: "Avery Admin (Demo)" },
  dispatcher: { email: "dispatcher@demo.example", password: "DemoDispatch!2026", name: "Dana Dispatcher (Demo)" },
  ownerA: { email: "owner@northstar-demo.example", password: "DemoCarrierA!2026", name: "Nora Northstar (Demo)" },
  ownerB: { email: "owner@bluebonnet-demo.example", password: "DemoCarrierB!2026", name: "Ben Bluebonnet (Demo)" },
};

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data as NonNullable<T>;
}

async function ensureUser(u: { email: string; password: string; name: string }): Promise<string> {
  // profiles mirrors auth.users (trigger), so this lookup does not depend on paging the admin API.
  const { data: profile } = await db.from("profiles").select("id").eq("email", u.email).maybeSingle();
  if (profile) return profile.id;
  for (let page = 1; page < 20; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const found = data.users.find((x) => x.email === u.email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  const { data: created, error } = await db.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { full_name: u.name },
  });
  if (error || !created.user) throw new Error(`create user ${u.email}: ${error?.message}`);
  await db.from("profiles").update({ full_name: u.name }).eq("id", created.user.id);
  return created.user.id;
}

async function ensureRole(userId: string, role: "super_admin" | "admin" | "dispatcher") {
  const { data } = await db.from("user_roles").select("id").eq("user_id", userId).eq("role", role).is("revoked_at", null).maybeSingle();
  if (!data) must(await db.from("user_roles").insert({ user_id: userId, role }).select("id").single(), `grant ${role}`);
}

const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function storeObject(objectPath: string) {
  if (process.env.STORAGE_DRIVER === "local") {
    const dir = process.env.LOCAL_STORAGE_DIR ?? ".local-stack/storage";
    const target = path.join(dir, "carrier-documents", objectPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, MINIMAL_PDF);
  } else {
    await db.storage.from("carrier-documents").upload(objectPath, MINIMAL_PDF, { contentType: "application/pdf", upsert: true });
  }
}

async function addDocument(opts: {
  carrierId?: string;
  applicationId?: string;
  loadId?: string;
  docType: Database["public"]["Enums"]["document_type"];
  status: Database["public"]["Enums"]["document_status"];
  expiresOn?: string;
  label: string;
}) {
  const id = crypto.randomUUID();
  const folder = opts.applicationId ? `applications/${opts.applicationId}` : `carriers/${opts.carrierId}`;
  const storagePath = `${folder}/${id}/${opts.label}.pdf`;
  await storeObject(storagePath);
  must(
    await db
      .from("documents")
      .insert({
        id,
        carrier_id: opts.carrierId ?? null,
        application_id: opts.applicationId ?? null,
        load_id: opts.loadId ?? null,
        doc_type: opts.docType,
        status: opts.status,
        storage_path: storagePath,
        original_filename: `${opts.label}.pdf`,
        mime_type: "application/pdf",
        size_bytes: MINIMAL_PDF.byteLength,
        expires_on: opts.expiresOn ?? null,
      })
      .select("id")
      .single(),
    `document ${opts.label}`,
  );
  return id;
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function publishDemoAgreements() {
  const { data: versions } = await db
    .from("agreement_versions")
    .select("id, status, body_markdown, agreements!inner(key)")
    .in("agreements.key", ["dispatch_service_agreement", "broker_authorization"]);
  for (const v of versions ?? []) {
    if (v.status !== "draft") continue;
    const body = v.body_markdown.replaceAll("{{legal_entity}}", "Demo Dispatch Company LLC").replaceAll("{{cancellation_notice_days}}", "14");
    must(await db.from("agreement_versions").update({ body_markdown: body, status: "published" }).eq("id", v.id).select("id").single(), "publish agreement");
  }
}

interface CarrierSpec {
  legalName: string;
  mc: string;
  dot: string;
  owner: { email: string; password: string; name: string };
  equipment: "car_hauler" | "hotshot" | "box_truck" | "dry_van";
  feePlan: "standard_percentage" | "flat_weekly";
  homeCity: string;
  homeState: string;
  trucks: Array<{ unitNumber: string; equipmentType: string; year: number; make: string; model: string; vehicleCapacity?: number }>;
  drivers: Array<{ fullName: string; phone: string }>;
  factoring: { status: "factoring" | "quick_pay" | "none"; companyName?: string };
}

async function createCarrier(spec: CarrierSpec, dispatcherId: string): Promise<{ carrierId: string; ownerId: string; truckIds: string[]; driverIds: string[] }> {
  const existing = await db.from("carriers").select("id").eq("legal_name", spec.legalName).maybeSingle();
  if (existing.data) throw new Error(`already seeded: ${spec.legalName}`);

  const form = {
    contact: { fullName: spec.owner.name, email: spec.owner.email, phone: "555-010-0000", preferredContact: "phone" },
    business: {
      legalName: spec.legalName,
      mcNumber: spec.mc,
      usdotNumber: spec.dot,
      einLast4: "0000",
      yearsInBusiness: 4,
      authorityActiveDate: "2022-03-01",
      addressLine1: "100 Demo Way",
      city: spec.homeCity,
      state: spec.homeState,
      postalCode: "00000",
    },
    equipment: { primaryEquipmentType: spec.equipment, truckCount: spec.trucks.length, trucks: spec.trucks, trailers: [] },
    drivers: { drivers: spec.drivers.map((d) => ({ ...d, isOwnerOperator: false })) },
    lanes: { homeBaseCity: spec.homeCity, homeBaseState: spec.homeState, preferredStates: ["TX", "OK", "LA", "AR"], avoidStates: ["NY"], preferredLanes: [] },
    preferences: { minRatePerMile: 2.1, desiredWeeklyGross: 7000, daysAvailable: ["mon", "tue", "wed", "thu", "fri"], maxDeadheadMiles: 150 },
    factoring: spec.factoring,
    documents: { insuranceExpirationDate: daysFromNow(200) },
  };
  const app = must(
    await db
      .from("carrier_applications")
      .insert({
        email: spec.owner.email,
        contact_name: spec.owner.name,
        legal_name: spec.legalName,
        mc_number: spec.mc,
        usdot_number: spec.dot,
        primary_equipment_type: spec.equipment,
        truck_count: spec.trucks.length,
        home_base_state: spec.homeState,
        form_data: form,
        consent_version: "demo-seed",
        consent_accepted_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
    "application",
  );
  must(await db.from("carrier_applications").update({ status: "submitted" }).eq("id", app.id).select("id").single(), "submit application");
  for (const [docType, label] of [
    ["w9", "demo-w9"],
    ["certificate_of_insurance", "demo-coi"],
    ["operating_authority", "demo-authority"],
  ] as const) {
    await addDocument({ applicationId: app.id, docType, status: "pending_review", label });
  }
  const carrierId = must(
    await db.rpc("approve_application", { p_application_id: app.id, p_fee_plan_key: spec.feePlan, p_dispatcher_id: dispatcherId, p_note: "Demo seed" }),
    "approve application",
  );

  const ownerId = await ensureUser(spec.owner);
  const { data: carrier } = await db.from("carriers").select("organization_id").eq("id", carrierId).single();
  must(await db.from("organization_members").insert({ organization_id: carrier!.organization_id, user_id: ownerId, role: "carrier_owner" }).select("id").single(), "owner membership");
  must(await db.from("carrier_applications").update({ status: "onboarding" }).eq("id", app.id).select("id").single(), "onboarding status");

  // Onboarding: accept agreements, accept documents, verify authority, activate.
  const { data: versions } = await db.from("agreement_versions").select("id, body_sha256, agreements!inner(required_for_activation, audience)").eq("status", "published");
  for (const v of versions ?? []) {
    const agreement = v.agreements as unknown as { required_for_activation: boolean; audience: string };
    if (!agreement.required_for_activation || agreement.audience !== "carrier") continue;
    must(
      await db
        .from("agreement_acceptances")
        .insert({ agreement_version_id: v.id, carrier_id: carrierId, user_id: ownerId, signer_name: spec.owner.name, signer_title: "Owner", document_hash: v.body_sha256, ip_address: "127.0.0.1", user_agent: "demo-seed" })
        .select("id")
        .single(),
      "acceptance",
    );
  }
  const { data: docs } = await db.from("documents").select("id, doc_type").eq("carrier_id", carrierId);
  for (const d of docs ?? []) {
    must(
      await db
        .from("documents")
        .update({ status: "accepted", expires_on: d.doc_type === "certificate_of_insurance" ? daysFromNow(200) : null })
        .eq("id", d.id)
        .select("id")
        .single(),
      "accept document",
    );
  }
  must(
    await db.from("carriers").update({ authority_verification_status: "verified", authority_verification_notes: "Demo data — not a real authority" }).eq("id", carrierId).select("id").single(),
    "verify authority",
  );
  must(await db.from("carriers").update({ status: "active" }).eq("id", carrierId).select("id").single(), "activate carrier");

  const trucks = must(await db.from("trucks").select("id").eq("carrier_id", carrierId).order("unit_number"), "trucks");
  const drivers = must(await db.from("drivers").select("id").eq("carrier_id", carrierId).order("full_name"), "drivers");
  return { carrierId, ownerId, truckIds: trucks.map((t) => t.id), driverIds: drivers.map((d) => d.id) };
}

type LoadStatus = Database["public"]["Enums"]["load_status"];
const PATH: LoadStatus[] = ["proposed", "approved", "booked", "dispatched", "at_pickup", "loaded", "in_transit", "delivered", "paperwork_pending", "completed"];

async function createLoad(opts: {
  carrierId: string;
  dispatcherId: string;
  truckId: string;
  driverId: string;
  brokerId: string;
  brokerName: string;
  origin: [string, string];
  destination: [string, string];
  gross: number;
  loaded: number;
  deadhead: number;
  equipment: string;
  commodity: string;
  advanceTo: LoadStatus;
  vehicles?: Array<{ vin: string; year: number; make: string; model: string; vehicle_type: string; payment_amount: number; lot_number?: string }>;
  charges?: Array<{ charge_type: Database["public"]["Enums"]["charge_type"]; amount: number; description: string }>;
}) {
  const load = must(
    await db
      .from("loads")
      .insert({
        carrier_id: opts.carrierId,
        dispatcher_id: opts.dispatcherId,
        broker_id: opts.brokerId,
        broker_name: opts.brokerName,
        broker_contact_name: "Demo Broker Rep",
        broker_contact_phone: "555-0100",
        broker_load_number: `DEMO-${Math.floor(Math.random() * 90000 + 10000)}`,
        equipment_type: opts.equipment,
        commodity: opts.commodity,
        weight_lbs: 9000,
        gross_rate: opts.gross,
        loaded_miles: opts.loaded,
        deadhead_miles: opts.deadhead,
      })
      .select("id, carrier_id")
      .single(),
    "load",
  );
  const stops = must(
    await db
      .from("load_stops")
      .insert([
        {
          load_id: load.id,
          carrier_id: load.carrier_id,
          sequence: 1,
          stop_type: "pickup",
          facility_name: "Demo Auto Auction",
          city: opts.origin[0],
          state: opts.origin[1],
          window_start: new Date(Date.now() + 86_400_000).toISOString(),
          window_end: new Date(Date.now() + 86_400_000 + 4 * 3_600_000).toISOString(),
        },
        {
          load_id: load.id,
          carrier_id: load.carrier_id,
          sequence: 2,
          stop_type: "delivery",
          facility_name: "Demo Dealership",
          city: opts.destination[0],
          state: opts.destination[1],
          window_start: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          window_end: new Date(Date.now() + 3 * 86_400_000 + 4 * 3_600_000).toISOString(),
        },
      ])
      .select("id, stop_type"),
    "stops",
  );
  for (const v of opts.vehicles ?? []) {
    must(
      await db
        .from("load_vehicles")
        .insert({
          load_id: load.id,
          carrier_id: load.carrier_id,
          pickup_stop_id: stops.find((s) => s.stop_type === "pickup")!.id,
          delivery_stop_id: stops.find((s) => s.stop_type === "delivery")!.id,
          auction_or_dealer_name: "Demo Auto Auction",
          pickup_contact_name: "Gate Office (Demo)",
          keys_title_notes: "Keys with vehicle; title mailed separately",
          ...v,
        })
        .select("id")
        .single(),
      "vehicle",
    );
  }
  for (const c of opts.charges ?? []) {
    must(await db.from("load_charges").insert({ load_id: load.id, carrier_id: load.carrier_id, ...c }).select("id").single(), "charge");
  }
  if (opts.advanceTo === "opportunity") return load.id;
  for (const status of PATH.slice(0, PATH.indexOf(opts.advanceTo) + 1)) {
    if (status === "approved") {
      must(
        await db
          .from("load_approvals")
          .insert({
            load_id: load.id,
            carrier_id: load.carrier_id,
            decision: "approved",
            method: "phone",
            approver_name: "Carrier owner (Demo)",
            recorded_by: opts.dispatcherId,
            approved_gross_rate: opts.gross,
            note: "Demo seed: owner approved by phone",
          })
          .select("id")
          .single(),
        "approval",
      );
    }
    if (status === "booked") {
      must(await db.from("loads").update({ truck_id: opts.truckId, driver_id: opts.driverId }).eq("id", load.id).select("id").single(), "assign");
    }
    if (status === "completed") {
      for (const [docType, label] of [
        ["rate_confirmation", "rate-confirmation"],
        ["bill_of_lading", "bill-of-lading"],
        ["proof_of_delivery", "proof-of-delivery"],
      ] as const) {
        await addDocument({ carrierId: opts.carrierId, loadId: load.id, docType, status: "accepted", label });
      }
    }
    must(await db.from("loads").update({ status }).eq("id", load.id).select("id").single(), `status ${status}`);
  }
  return load.id;
}

async function main() {
  console.log(`Seeding demo data into ${url} …`);
  const adminId = await ensureUser(DEMO_USERS.admin);
  const dispatcherId = await ensureUser(DEMO_USERS.dispatcher);
  await ensureRole(adminId, "super_admin");
  await ensureRole(dispatcherId, "dispatcher");
  await publishDemoAgreements();

  const already = await db.from("carriers").select("id").ilike("legal_name", "%(Demo)%");
  if ((already.data ?? []).length) {
    console.log("Demo carriers already exist — skipping carrier and load data.");
    printCredentials();
    return;
  }

  const A = await createCarrier(
    {
      legalName: "Northstar Auto Transport LLC (Demo)",
      mc: "DEMO-100001",
      dot: "DEMO-200001",
      owner: DEMO_USERS.ownerA,
      equipment: "car_hauler",
      feePlan: "standard_percentage",
      homeCity: "Dallas",
      homeState: "TX",
      trucks: [
        { unitNumber: "NS-1", equipmentType: "car_hauler", year: 2021, make: "Peterbilt", model: "389", vehicleCapacity: 9 },
        { unitNumber: "NS-2", equipmentType: "car_hauler", year: 2019, make: "Ram", model: "5500", vehicleCapacity: 3 },
      ],
      drivers: [
        { fullName: "Nora Northstar (Demo)", phone: "555-010-1001" },
        { fullName: "Sam Rivera (Demo)", phone: "555-010-1002" },
      ],
      factoring: { status: "factoring", companyName: "Demo Factoring Co" },
    },
    dispatcherId,
  );
  const B = await createCarrier(
    {
      legalName: "Bluebonnet Freight LLC (Demo)",
      mc: "DEMO-100002",
      dot: "DEMO-200002",
      owner: DEMO_USERS.ownerB,
      equipment: "hotshot",
      feePlan: "flat_weekly",
      homeCity: "Oklahoma City",
      homeState: "OK",
      trucks: [{ unitNumber: "BB-7", equipmentType: "hotshot", year: 2022, make: "Ford", model: "F-450" }],
      drivers: [{ fullName: "Ben Bluebonnet (Demo)", phone: "555-010-2001" }],
      factoring: { status: "quick_pay" },
    },
    adminId,
  );

  const brokers = must(
    await db
      .from("brokers")
      .insert([
        { name: "Example Vehicle Logistics (Demo)", mc_number: "DEMO-900001", phone: "555-0190", credit_notes: "Demo: pays in 30 days; quick pay available.", payment_terms: "Net 30" },
        { name: "Sample Freight Partners (Demo)", mc_number: "DEMO-900002", phone: "555-0191", credit_notes: "Demo: requires signed rate confirmation before dispatch.", payment_terms: "Net 21" },
      ])
      .select("id, name"),
    "brokers",
  );
  const [b1, b2] = brokers as [{ id: string; name: string }, { id: string; name: string }];

  const aTruck = A.truckIds[0]!;
  const aDriver = A.driverIds[0]!;
  const common = { carrierId: A.carrierId, dispatcherId, truckId: aTruck, driverId: aDriver, equipment: "car_hauler", commodity: "Used vehicles" };
  await createLoad({
    ...common,
    brokerId: b1.id,
    brokerName: b1.name,
    origin: ["Dallas", "TX"],
    destination: ["Atlanta", "GA"],
    gross: 3150,
    loaded: 780,
    deadhead: 45,
    advanceTo: "completed",
    vehicles: [
      { vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", vehicle_type: "sedan", payment_amount: 1050, lot_number: "DEMO-LOT-11" },
      { vin: "2T1BURHE5JC012345", year: 2018, make: "Toyota", model: "Corolla", vehicle_type: "sedan", payment_amount: 1050, lot_number: "DEMO-LOT-12" },
      { vin: "1FTEW1EP5JFA12345", year: 2018, make: "Ford", model: "F-150", vehicle_type: "pickup", payment_amount: 1050, lot_number: "DEMO-LOT-13" },
    ],
    charges: [{ charge_type: "detention", amount: 150, description: "2 hours at delivery (demo)" }],
  });
  await createLoad({ ...common, brokerId: b2.id, brokerName: b2.name, origin: ["Atlanta", "GA"], destination: ["Nashville", "TN"], gross: 1400, loaded: 250, deadhead: 20, advanceTo: "completed" });
  await createLoad({ ...common, truckId: A.truckIds[1]!, driverId: A.driverIds[1]!, brokerId: b1.id, brokerName: b1.name, origin: ["Houston", "TX"], destination: ["Memphis", "TN"], gross: 1850, loaded: 570, deadhead: 60, advanceTo: "in_transit" });
  await createLoad({ ...common, brokerId: b2.id, brokerName: b2.name, origin: ["Nashville", "TN"], destination: ["Dallas", "TX"], gross: 2100, loaded: 665, deadhead: 30, advanceTo: "booked" });
  await createLoad({ ...common, brokerId: b1.id, brokerName: b1.name, origin: ["Dallas", "TX"], destination: ["Phoenix", "AZ"], gross: 2650, loaded: 1065, deadhead: 25, advanceTo: "proposed" });
  await createLoad({ ...common, brokerId: b2.id, brokerName: b2.name, origin: ["Dallas", "TX"], destination: ["Denver", "CO"], gross: 2300, loaded: 795, deadhead: 15, advanceTo: "opportunity" });

  const bCommon = { carrierId: B.carrierId, dispatcherId: adminId, truckId: B.truckIds[0]!, driverId: B.driverIds[0]!, equipment: "hotshot", commodity: "Oilfield equipment" };
  await createLoad({ ...bCommon, brokerId: b2.id, brokerName: b2.name, origin: ["Oklahoma City", "OK"], destination: ["Midland", "TX"], gross: 1600, loaded: 380, deadhead: 40, advanceTo: "completed" });
  await createLoad({ ...bCommon, brokerId: b1.id, brokerName: b1.name, origin: ["Midland", "TX"], destination: ["Tulsa", "OK"], gross: 1450, loaded: 470, deadhead: 20, advanceTo: "proposed" });
  const tonuLoad = await createLoad({ ...bCommon, brokerId: b1.id, brokerName: b1.name, origin: ["Tulsa", "OK"], destination: ["Wichita", "KS"], gross: 900, loaded: 180, deadhead: 10, advanceTo: "at_pickup" });
  must(await db.from("load_charges").insert({ load_id: tonuLoad, carrier_id: B.carrierId, charge_type: "tonu", amount: 250, description: "Shipper cancelled on arrival (demo)" }).select("id").single(), "tonu");
  must(await db.from("loads").update({ status: "cancelled", cancellation_reason: "Shipper cancelled on arrival; returned to broker (demo)" }).eq("id", tonuLoad).select("id").single(), "cancel");

  // Availability and preferences
  must(
    await db
      .from("driver_availability")
      .insert([
        { carrier_id: A.carrierId, driver_id: A.driverIds[0]!, truck_id: A.truckIds[0]!, available_from: new Date(Date.now() - 3_600_000).toISOString(), location_city: "Dallas", location_state: "TX", notes: "Ready for a reload (demo)" },
        { carrier_id: B.carrierId, driver_id: B.driverIds[0]!, truck_id: B.truckIds[0]!, available_from: new Date(Date.now() + 86_400_000).toISOString(), location_city: "Tulsa", location_state: "OK" },
      ])
      .select("id"),
    "availability",
  );

  // Weekly statements for the current week: issue A's (percentage) and B's (flat), record a payment for B.
  const week = weekStart(new Date(), TZ);
  const stmtA = must(await db.rpc("generate_weekly_statement", { p_carrier_id: A.carrierId, p_period_start: week }), "statement A");
  const invoiceA = must(await db.rpc("issue_weekly_statement", { p_statement_id: stmtA, p_due_days: 7 }), "issue A");
  const stmtB = must(await db.rpc("generate_weekly_statement", { p_carrier_id: B.carrierId, p_period_start: week }), "statement B");
  const invoiceB = must(await db.rpc("issue_weekly_statement", { p_statement_id: stmtB, p_due_days: 7 }), "issue B");
  const { data: invB } = await db.from("invoices").select("balance_due").eq("id", invoiceB).single();
  must(
    await db.from("payments").insert({ invoice_id: invoiceB, carrier_id: B.carrierId, amount: invB?.balance_due ?? 0, method: "ach", reference: "DEMO-ACH-0001", notes: "Demo payment" }).select("id").single(),
    "payment",
  );

  must(
    await db
      .from("tasks")
      .insert([
        { title: "Confirm Phoenix reload options (demo)", carrier_id: A.carrierId, kind: "load", priority: "normal", assigned_to: dispatcherId, due_at: new Date(Date.now() + 86_400_000).toISOString() },
        { title: "Review Bluebonnet COI renewal (demo)", carrier_id: B.carrierId, kind: "documents", priority: "high", assigned_to: adminId },
      ])
      .select("id"),
    "tasks",
  );
  must(
    await db
      .from("support_requests")
      .insert({ carrier_id: A.carrierId, created_by: A.ownerId, category: "billing", subject: "Question about detention on last load (demo)", body: "Can you confirm detention was billed to the broker?" })
      .select("id")
      .single(),
    "support",
  );
  must(
    await db
      .from("communications")
      .insert({ carrier_id: A.carrierId, channel: "phone", direction: "outbound", visibility: "internal", subject: "Weekly check-in (demo)", body_text: "Discussed lanes for next week.", status: "logged" })
      .select("id")
      .single(),
    "communication",
  );
  console.log(`Invoice A: ${invoiceA} (open) · Invoice B: ${invoiceB} (paid)`);
  printCredentials();
}

function printCredentials() {
  console.log("\nDemo accounts (fictional; local/staging use only):");
  for (const [role, u] of Object.entries(DEMO_USERS)) console.log(`  ${role.padEnd(10)} ${u.email.padEnd(32)} ${u.password}`);
  console.log("\nNote: the seed publishes the DRAFT agreement templates for demo use. They require attorney review before production.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

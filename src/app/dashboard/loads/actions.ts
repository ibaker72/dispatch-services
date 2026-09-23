"use server";

import { z } from "zod";
import { type ActionResult, DbError, runAction, runFormAction } from "@/lib/actions";
import { requireStaff } from "@/lib/auth/session";
import { Constants } from "@/lib/db/database.types";
import { zonedLocalToIso } from "@/lib/domain/dates";
import { LOAD_STATUSES } from "@/lib/domain/load-workflow";
import { AppError } from "@/lib/errors";
import { trackServer } from "@/lib/analytics/server";
import { notifyLoadProposed, notifyLoadStatus } from "@/lib/loads";
import { formBool, formOptionalText, formOptionalUuid, requiredText } from "@/lib/validation/common";
import { getOperationsSettings } from "@/lib/settings";
import { type LoadCreateInput, loadCreateSchema, loadDetailsSchema, stopSchema, vehicleSchema } from "@/lib/validation/load";

/** Stop times are entered as wall-clock times in the business timezone. */
async function toInstant(local: string | undefined): Promise<string | null> {
  if (!local) return null;
  const { timezone } = await getOperationsSettings();
  return zonedLocalToIso(local, timezone);
}

const loadId = z.object({ load_id: z.uuid() });

export async function createLoad(input: LoadCreateInput): Promise<ActionResult<string>> {
  return runAction(loadCreateSchema, input, async (v) => {
    const ctx = await requireStaff();
    let brokerId = v.broker_id ?? null;
    if (!brokerId && v.save_broker) {
      const { data: broker, error } = await ctx.supabase
        .from("brokers")
        .insert({ name: v.broker_name, mc_number: v.broker_mc_number ?? null, phone: v.broker_contact_phone ?? null, email: v.broker_contact_email ?? null, created_by: ctx.userId })
        .select("id")
        .single();
      if (error) throw new DbError(error);
      brokerId = broker.id;
    }
    const { data: id, error } = await ctx.supabase.rpc("create_load", {
      p_load: {
        carrier_id: v.carrier_id,
        dispatcher_id: ctx.userId,
        broker_id: brokerId,
        broker_name: v.broker_name,
        broker_mc_number: v.broker_mc_number ?? null,
        broker_contact_name: v.broker_contact_name ?? null,
        broker_contact_phone: v.broker_contact_phone ?? null,
        broker_contact_email: v.broker_contact_email ?? null,
        broker_load_number: v.broker_load_number ?? null,
        equipment_type: v.equipment_type ?? null,
        commodity: v.commodity ?? null,
        weight_lbs: v.weight_lbs ?? null,
        gross_rate: v.gross_rate ? Number(v.gross_rate) : null,
        loaded_miles: v.loaded_miles ?? null,
        deadhead_miles: v.deadhead_miles ?? 0,
      },
      p_stops: await Promise.all(v.stops.map(async (s) => ({ ...s, window_start: await toInstant(s.window_start), window_end: await toInstant(s.window_end) }))),
      p_vehicles: v.vehicles,
    });
    if (error || !id) throw new DbError(error ?? { message: "create failed" });
    if (v.internal_note) {
      const { data: load } = await ctx.supabase.from("loads").select("carrier_id").eq("id", id).single();
      if (load) await ctx.supabase.from("load_notes").insert({ load_id: id, carrier_id: load.carrier_id, visibility: "internal", body: v.internal_note, author_id: ctx.userId });
    }
    return id;
  });
}

async function staffLoad(id: string) {
  const ctx = await requireStaff();
  const { data: load } = await ctx.supabase.from("loads").select("id, carrier_id, status, gross_rate").eq("id", id).maybeSingle();
  if (!load) throw new AppError("Load not found.", "not_found");
  return { ctx, load };
}

export async function updateLoadDetails(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(loadDetailsSchema.extend(loadId.shape), fd, async ({ load_id, ...v }) => {
    const { ctx } = await staffLoad(load_id);
    const { error } = await ctx.supabase
      .from("loads")
      .update({
        broker_id: v.broker_id ?? null,
        broker_name: v.broker_name,
        broker_mc_number: v.broker_mc_number ?? null,
        broker_contact_name: v.broker_contact_name ?? null,
        broker_contact_phone: v.broker_contact_phone ?? null,
        broker_contact_email: v.broker_contact_email ?? null,
        broker_load_number: v.broker_load_number ?? null,
        equipment_type: v.equipment_type ?? null,
        commodity: v.commodity ?? null,
        weight_lbs: v.weight_lbs ?? null,
        gross_rate: v.gross_rate ? Number(v.gross_rate) : null,
        loaded_miles: v.loaded_miles ?? null,
        deadhead_miles: v.deadhead_miles ?? 0,
      })
      .eq("id", load_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function assignLoadEquipment(fd: FormData): Promise<ActionResult<null>> {
  const schema = loadId.extend({ truck_id: formOptionalUuid, trailer_id: formOptionalUuid, driver_id: formOptionalUuid, dispatcher_id: formOptionalUuid });
  return runFormAction(schema, fd, async ({ load_id, truck_id, trailer_id, driver_id, dispatcher_id }) => {
    const { ctx } = await staffLoad(load_id);
    const { error } = await ctx.supabase
      .from("loads")
      .update({ truck_id: truck_id ?? null, trailer_id: trailer_id ?? null, driver_id: driver_id ?? null, ...(dispatcher_id ? { dispatcher_id } : {}) })
      .eq("id", load_id);
    if (error) throw new DbError(error);
    return null;
  });
}

const DISPATCHER_TARGETS = LOAD_STATUSES.filter((s) => s !== "approved" && s !== "cancelled");

export async function changeLoadStatus(fd: FormData): Promise<ActionResult<null>> {
  const schema = loadId.extend({ status: z.enum(DISPATCHER_TARGETS as [string, ...string[]]), status_note: formOptionalText(1000) });
  return runFormAction(schema, fd, async ({ load_id, status, status_note }) => {
    const { ctx } = await staffLoad(load_id);
    const { error } = await ctx.supabase
      .from("loads")
      .update({ status: status as (typeof LOAD_STATUSES)[number], status_note: status_note ?? null })
      .eq("id", load_id);
    if (error) throw new DbError(error);
    if (status === "proposed") await notifyLoadProposed(load_id);
    else await notifyLoadStatus(load_id, status as (typeof LOAD_STATUSES)[number], status_note);
    return null;
  });
}

export async function cancelLoad(fd: FormData): Promise<ActionResult<null>> {
  const schema = loadId.extend({
    cancellation_reason: requiredText("A reason", 1000).min(3, "Give a short reason"),
    cancellation_disposition: z.enum(["returned_to_broker", "broker_cancelled"]),
  });
  return runFormAction(schema, fd, async ({ load_id, cancellation_reason, cancellation_disposition }) => {
    const { ctx } = await staffLoad(load_id);
    const { error } = await ctx.supabase.from("loads").update({ status: "cancelled", cancellation_reason, cancellation_disposition }).eq("id", load_id);
    if (error) throw new DbError(error);
    await notifyLoadStatus(load_id, "cancelled", cancellation_reason);
    return null;
  });
}

export async function recordCarrierDecision(fd: FormData): Promise<ActionResult<null>> {
  const schema = loadId.extend({
    decision: z.enum(["approved", "rejected"]),
    method: z.enum(["phone", "email", "text_message"]),
    approver_name: requiredText("The carrier representative's name", 200).min(2),
    approver_user_id: formOptionalUuid,
    note: requiredText("Evidence", 2000).min(10, "Describe the carrier's decision in at least 10 characters (who, when, what they said)"),
  });
  return runFormAction(schema, fd, async ({ load_id, decision, method, approver_name, approver_user_id, note }) => {
    const { ctx } = await staffLoad(load_id);
    const { error } = await ctx.supabase.rpc("record_carrier_load_decision", {
      p_load_id: load_id,
      p_decision: decision,
      p_method: method,
      p_approver_name: approver_name,
      p_note: note,
      p_approver_user_id: approver_user_id,
    });
    if (error) throw new DbError(error);
    await trackServer(decision === "approved" ? "load_approved" : "load_rejected", ctx.userId, { via: `staff_${method}` });
    return null;
  });
}

export async function saveStop(fd: FormData): Promise<ActionResult<null>> {
  const schema = stopSchema.and(loadId.extend({ stop_id: formOptionalUuid }));
  return runFormAction(schema, fd, async ({ load_id, stop_id, ...s }) => {
    const { ctx, load } = await staffLoad(load_id);
    const row = {
      stop_type: s.stop_type,
      facility_name: s.facility_name ?? null,
      address_line1: s.address_line1 ?? null,
      city: s.city,
      state: s.state,
      postal_code: s.postal_code ?? null,
      appointment_type: s.appointment_type,
      window_start: await toInstant(s.window_start),
      window_end: await toInstant(s.window_end),
      contact_name: s.contact_name ?? null,
      contact_phone: s.contact_phone ?? null,
      instructions: s.instructions ?? null,
    };
    if (stop_id) {
      const { error } = await ctx.supabase.from("load_stops").update(row).eq("id", stop_id).eq("load_id", load_id);
      if (error) throw new DbError(error);
    } else {
      const { data: last } = await ctx.supabase.from("load_stops").select("sequence").eq("load_id", load_id).order("sequence", { ascending: false }).limit(1).maybeSingle();
      const { error } = await ctx.supabase.from("load_stops").insert({ ...row, load_id, carrier_id: load.carrier_id, sequence: (last?.sequence ?? 0) + 1 });
      if (error) throw new DbError(error);
    }
    return null;
  });
}

export async function recordStopTime(fd: FormData): Promise<ActionResult<null>> {
  const schema = loadId.extend({ stop_id: z.uuid(), field: z.enum(["arrived_at", "departed_at"]) });
  return runFormAction(schema, fd, async ({ load_id, stop_id, field }) => {
    const { ctx } = await staffLoad(load_id);
    const { error } = await ctx.supabase.from("load_stops").update(field === "arrived_at" ? { arrived_at: new Date().toISOString() } : { departed_at: new Date().toISOString() }).eq("id", stop_id).eq("load_id", load_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function removeStop(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(loadId.extend({ stop_id: z.uuid() }), fd, async ({ load_id, stop_id }) => {
    const { ctx, load } = await staffLoad(load_id);
    if (!["opportunity", "proposed"].includes(load.status)) throw new AppError("Stops can be removed only before the carrier approves the load.");
    const { error } = await ctx.supabase.from("load_stops").delete().eq("id", stop_id).eq("load_id", load_id);
    if (error) throw new DbError(error.code === "23503" ? { ...error, message: "A vehicle on this load uses that stop. Update the vehicle first." } : error);
    return null;
  });
}

export async function saveVehicle(fd: FormData): Promise<ActionResult<null>> {
  const schema = vehicleSchema.omit({ pickup_sequence: true, delivery_sequence: true }).extend({
    ...loadId.shape,
    vehicle_id: formOptionalUuid,
    pickup_stop_id: formOptionalUuid,
    delivery_stop_id: formOptionalUuid,
    inspection_status: z.enum(["pending", "pickup_inspected", "delivery_inspected", "damage_noted"]).default("pending"),
    document_status: z.enum(["pending", "received", "verified"]).default("pending"),
  });
  return runFormAction(schema, fd, async ({ load_id, vehicle_id, ...v }) => {
    const { ctx, load } = await staffLoad(load_id);
    const row = {
      vin: v.vin ?? null,
      year: v.year ?? null,
      make: v.make ?? null,
      model: v.model ?? null,
      vehicle_type: v.vehicle_type,
      operable: v.operable,
      auction_or_dealer_name: v.auction_or_dealer_name ?? null,
      lot_number: v.lot_number ?? null,
      pickup_contact_name: v.pickup_contact_name ?? null,
      pickup_contact_phone: v.pickup_contact_phone ?? null,
      delivery_contact_name: v.delivery_contact_name ?? null,
      delivery_contact_phone: v.delivery_contact_phone ?? null,
      keys_title_notes: v.keys_title_notes ?? null,
      pickup_stop_id: v.pickup_stop_id ?? null,
      delivery_stop_id: v.delivery_stop_id ?? null,
      inspection_status: v.inspection_status,
      document_status: v.document_status,
    };
    const { error } = vehicle_id
      ? await ctx.supabase.from("load_vehicles").update(row).eq("id", vehicle_id).eq("load_id", load_id)
      : await ctx.supabase.from("load_vehicles").insert({ ...row, load_id, carrier_id: load.carrier_id });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function removeVehicle(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(loadId.extend({ vehicle_id: z.uuid() }), fd, async ({ load_id, vehicle_id }) => {
    const { ctx } = await staffLoad(load_id);
    const { error } = await ctx.supabase.from("load_vehicles").delete().eq("id", vehicle_id).eq("load_id", load_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function addCharge(fd: FormData): Promise<ActionResult<null>> {
  const schema = loadId.extend({
    charge_type: z.enum(Constants.public.Enums.charge_type),
    amount: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount like 150.00").refine((v) => Number(v) > 0, "Amount must be more than zero"),
    description: formOptionalText(500),
  });
  return runFormAction(schema, fd, async ({ load_id, charge_type, amount, description }) => {
    const { ctx, load } = await staffLoad(load_id);
    const { error } = await ctx.supabase
      .from("load_charges")
      .insert({ load_id, carrier_id: load.carrier_id, charge_type, amount: Number(amount), description: description ?? null, created_by: ctx.userId });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function removeCharge(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(loadId.extend({ charge_id: z.uuid() }), fd, async ({ load_id, charge_id }) => {
    const { ctx } = await staffLoad(load_id);
    const { error } = await ctx.supabase.from("load_charges").delete().eq("id", charge_id).eq("load_id", load_id);
    if (error) throw new DbError(error);
    return null;
  });
}

export async function addLoadNote(fd: FormData): Promise<ActionResult<null>> {
  const schema = loadId.extend({ body: requiredText("Note", 5000), share_with_carrier: formBool, broker_credit: formBool });
  return runFormAction(schema, fd, async ({ load_id, body, share_with_carrier, broker_credit }) => {
    const { ctx, load } = await staffLoad(load_id);
    const { error } = await ctx.supabase.from("load_notes").insert({
      load_id,
      carrier_id: load.carrier_id,
      body,
      kind: broker_credit ? "broker_credit" : "note",
      visibility: share_with_carrier && !broker_credit ? "carrier" : "internal",
      author_id: ctx.userId,
    });
    if (error) throw new DbError(error);
    return null;
  });
}

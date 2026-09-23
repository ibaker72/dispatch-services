"use server";

import { z } from "zod";
import { type ActionResult, DbError, runFormAction } from "@/lib/actions";
import { getAuthContext } from "@/lib/auth/session";
import { EQUIPMENT_KEYS } from "@/config/business";
import { AppError } from "@/lib/errors";
import { formBool, formOptionalDate, formOptionalNumber, formOptionalText, formOptionalUuid, requiredText, stateSchema } from "@/lib/validation/common";
import { TRAILER_TYPES } from "@/lib/validation/application";

/**
 * Fleet maintenance shared by the dispatch dashboard and the carrier portal.
 * Authorization is enforced by RLS on every table (staff with access to the
 * carrier, or the carrier's owner; any carrier member may post availability).
 */
async function signedIn() {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.emailVerified) throw new AppError("Please sign in again.", "unauthenticated");
  return ctx;
}

const optionalState = z.preprocess((v) => (v === "" ? undefined : v), stateSchema.optional());
const vin = z.preprocess(
  (v) => (v === "" ? undefined : typeof v === "string" ? v.trim().toUpperCase() : v),
  z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VINs are 17 letters and numbers (no I, O or Q)").optional(),
);

const truckSchema = z.object({
  carrier_id: z.uuid(),
  id: formOptionalUuid,
  unit_number: requiredText("Unit number", 40),
  equipment_type: z.enum(EQUIPMENT_KEYS),
  year: formOptionalNumber(1980, new Date().getFullYear() + 1, "Year"),
  make: formOptionalText(60),
  model: formOptionalText(60),
  vin,
  license_plate: formOptionalText(20),
  plate_state: optionalState,
  vehicle_capacity: formOptionalNumber(0, 20, "Vehicle capacity"),
  max_payload_lbs: formOptionalNumber(0, 200000, "Maximum payload"),
  status: z.enum(["active", "inactive", "out_of_service"]).default("active"),
  notes: formOptionalText(1000),
});

export async function saveTruck(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(truckSchema, fd, async ({ id, carrier_id, ...v }) => {
    const ctx = await signedIn();
    const row = {
      unit_number: v.unit_number,
      equipment_type: v.equipment_type,
      year: v.year ?? null,
      make: v.make ?? null,
      model: v.model ?? null,
      vin: v.vin ?? null,
      license_plate: v.license_plate ?? null,
      plate_state: v.plate_state ?? null,
      vehicle_capacity: v.vehicle_capacity ?? null,
      max_payload_lbs: v.max_payload_lbs ?? null,
      status: v.status,
      notes: v.notes ?? null,
    };
    const { error } = id
      ? await ctx.supabase.from("trucks").update(row).eq("id", id).eq("carrier_id", carrier_id)
      : await ctx.supabase.from("trucks").insert({ ...row, carrier_id });
    if (error) throw new DbError(error.code === "23505" ? { ...error, message: "That unit number is already used." } : error);
    return null;
  });
}

const trailerSchema = z.object({
  carrier_id: z.uuid(),
  id: formOptionalUuid,
  trailer_type: z.enum(TRAILER_TYPES),
  truck_id: formOptionalUuid,
  length_ft: formOptionalNumber(1, 99, "Length"),
  vehicle_capacity: formOptionalNumber(0, 20, "Vehicle capacity"),
  max_payload_lbs: formOptionalNumber(0, 200000, "Maximum payload"),
  vin,
  license_plate: formOptionalText(20),
  status: z.enum(["active", "inactive", "out_of_service"]).default("active"),
  notes: formOptionalText(1000),
});

export async function saveTrailer(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(trailerSchema, fd, async ({ id, carrier_id, ...v }) => {
    const ctx = await signedIn();
    const row = {
      trailer_type: v.trailer_type,
      truck_id: v.truck_id ?? null,
      length_ft: v.length_ft ?? null,
      vehicle_capacity: v.vehicle_capacity ?? null,
      max_payload_lbs: v.max_payload_lbs ?? null,
      vin: v.vin ?? null,
      license_plate: v.license_plate ?? null,
      status: v.status,
      notes: v.notes ?? null,
    };
    const { error } = id
      ? await ctx.supabase.from("trailers").update(row).eq("id", id).eq("carrier_id", carrier_id)
      : await ctx.supabase.from("trailers").insert({ ...row, carrier_id });
    if (error) throw new DbError(error);
    return null;
  });
}

const driverSchema = z.object({
  carrier_id: z.uuid(),
  id: formOptionalUuid,
  full_name: requiredText("Driver name", 120),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.email("Enter a valid email address").max(254).optional()),
  phone: formOptionalText(40),
  license_state: optionalState,
  license_expiration: formOptionalDate,
  medical_card_expiration: formOptionalDate,
  is_owner_operator: formBool,
  status: z.enum(["active", "inactive"]).default("active"),
  notes: formOptionalText(1000),
});

export async function saveDriver(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(driverSchema, fd, async ({ id, carrier_id, ...v }) => {
    const ctx = await signedIn();
    const row = {
      full_name: v.full_name,
      email: v.email ?? null,
      phone: v.phone ?? null,
      license_state: v.license_state ?? null,
      license_expiration: v.license_expiration ?? null,
      medical_card_expiration: v.medical_card_expiration ?? null,
      is_owner_operator: v.is_owner_operator,
      status: v.status,
      notes: v.notes ?? null,
    };
    const { error } = id
      ? await ctx.supabase.from("drivers").update(row).eq("id", id).eq("carrier_id", carrier_id)
      : await ctx.supabase.from("drivers").insert({ ...row, carrier_id });
    if (error) throw new DbError(error);
    return null;
  });
}

const availabilitySchema = z
  .object({
    carrier_id: z.uuid(),
    driver_id: z.uuid("Choose a driver"),
    truck_id: formOptionalUuid,
    status: z.enum(["available", "unavailable", "home_time"]),
    available_from: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Enter a start date and time"),
    available_until: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/).optional()),
    timezone_offset: z.coerce.number().int().min(-900).max(900).default(0),
    location_city: formOptionalText(100),
    location_state: optionalState,
    notes: formOptionalText(1000),
  })
  .refine((v) => !v.available_until || v.available_until > v.available_from, { path: ["available_until"], message: "End must be after the start" });

/** datetime-local values carry no zone; the browser sends its UTC offset (minutes, as from getTimezoneOffset). */
function toIso(local: string, offsetMinutes: number) {
  const utc = Date.parse(`${local.slice(0, 16)}:00Z`) + offsetMinutes * 60_000;
  return new Date(utc).toISOString();
}

export async function addAvailability(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(availabilitySchema, fd, async (v) => {
    const ctx = await signedIn();
    const { error } = await ctx.supabase.from("driver_availability").insert({
      carrier_id: v.carrier_id,
      driver_id: v.driver_id,
      truck_id: v.truck_id ?? null,
      status: v.status,
      available_from: toIso(v.available_from, v.timezone_offset),
      available_until: v.available_until ? toIso(v.available_until, v.timezone_offset) : null,
      location_city: v.location_city ?? null,
      location_state: v.location_state ?? null,
      notes: v.notes ?? null,
      created_by: ctx.userId,
    });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function removeAvailability(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ id: z.uuid() }), fd, async ({ id }) => {
    const ctx = await signedIn();
    const { error } = await ctx.supabase.from("driver_availability").delete().eq("id", id);
    if (error) throw new DbError(error);
    return null;
  });
}

const laneSchema = z
  .object({
    carrier_id: z.uuid(),
    preference: z.enum(["preferred", "avoid"]),
    origin_state: optionalState,
    destination_state: optionalState,
    min_rate_per_mile: formOptionalNumber(0, 50, "Minimum rate"),
    notes: formOptionalText(500),
  })
  .refine((v) => v.origin_state || v.destination_state, { path: ["destination_state"], message: "Choose an origin or destination state" });

export async function addLanePreference(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(laneSchema, fd, async (v) => {
    const ctx = await signedIn();
    const { error } = await ctx.supabase.from("lane_preferences").insert({
      carrier_id: v.carrier_id,
      preference: v.preference,
      origin_state: v.origin_state ?? null,
      destination_state: v.destination_state ?? null,
      min_rate_per_mile: v.min_rate_per_mile ?? null,
      notes: v.notes ?? null,
      created_by: ctx.userId,
    });
    if (error) throw new DbError(error);
    return null;
  });
}

export async function removeLanePreference(fd: FormData): Promise<ActionResult<null>> {
  return runFormAction(z.object({ id: z.uuid() }), fd, async ({ id }) => {
    const ctx = await signedIn();
    const { error } = await ctx.supabase.from("lane_preferences").delete().eq("id", id);
    if (error) throw new DbError(error);
    return null;
  });
}

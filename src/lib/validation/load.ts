import { z } from "zod";
import { EQUIPMENT_KEYS } from "@/config/business";
import { stateSchema } from "@/lib/validation/common";

/** Load forms submit strings; these helpers normalize "" to undefined. */
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max, `Must be ${max} characters or fewer`).optional());
const reqText = (label: string, max: number) => z.string().trim().min(1, `${label} is required`).max(max, `Must be ${max} characters or fewer`);
const optNumber = (min: number, max: number, label: string) =>
  z.preprocess(blank, z.coerce.number({ message: `${label} must be a number` }).min(min, `${label} must be at least ${min}`).max(max, `${label} is too large`).optional());
const money = (label: string) =>
  z.preprocess(blank, z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, `${label} must be a dollar amount like 1850.00`).optional());
const localDateTime = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Enter a date and time").optional());

export const LOAD_VEHICLE_TYPES = ["sedan", "coupe", "suv", "pickup", "van", "motorcycle", "heavy_equipment", "other"] as const;
export const VEHICLE_TYPE_LABELS: Record<(typeof LOAD_VEHICLE_TYPES)[number], string> = {
  sedan: "Sedan",
  coupe: "Coupe",
  suv: "SUV",
  pickup: "Pickup truck",
  van: "Van",
  motorcycle: "Motorcycle",
  heavy_equipment: "Heavy equipment",
  other: "Other",
};

export const stopSchema = z
  .object({
    stop_type: z.enum(["pickup", "delivery"]),
    facility_name: optText(200),
    address_line1: optText(200),
    city: reqText("City", 100),
    state: stateSchema,
    postal_code: z.preprocess(blank, z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code").optional()),
    appointment_type: z.enum(["appointment", "window", "fcfs"]).default("window"),
    window_start: localDateTime,
    window_end: localDateTime,
    contact_name: optText(200),
    contact_phone: optText(40),
    instructions: optText(2000),
  })
  .refine((s) => !s.window_start || !s.window_end || s.window_end >= s.window_start, { path: ["window_end"], message: "End must be after the start" });

export const vehicleSchema = z.object({
  vin: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v),
    z.string().regex(/^[A-HJ-NPR-Z0-9]{11,17}$/, "VINs are 11–17 letters and numbers (no I, O or Q)").optional(),
  ),
  year: optNumber(1900, 2100, "Year"),
  make: optText(60),
  model: optText(60),
  vehicle_type: z.enum(LOAD_VEHICLE_TYPES).default("other"),
  operable: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  auction_or_dealer_name: optText(200),
  lot_number: optText(60),
  pickup_contact_name: optText(200),
  pickup_contact_phone: optText(40),
  delivery_contact_name: optText(200),
  delivery_contact_phone: optText(40),
  keys_title_notes: optText(1000),
  pickup_sequence: optNumber(1, 50, "Pickup stop"),
  delivery_sequence: optNumber(1, 50, "Delivery stop"),
});

export const loadDetailsSchema = z.object({
  broker_id: z.preprocess(blank, z.uuid().optional()),
  broker_name: reqText("Broker name", 200),
  broker_mc_number: optText(20),
  broker_contact_name: optText(200),
  broker_contact_phone: optText(40),
  broker_contact_email: z.preprocess(blank, z.email("Enter a valid email address").max(254).optional()),
  broker_load_number: optText(60),
  equipment_type: z.preprocess(blank, z.enum(EQUIPMENT_KEYS).optional()),
  commodity: optText(200),
  weight_lbs: optNumber(0, 200000, "Weight"),
  gross_rate: money("Gross rate"),
  loaded_miles: optNumber(0, 10000, "Loaded miles"),
  deadhead_miles: optNumber(0, 5000, "Deadhead miles"),
});

export const loadCreateSchema = loadDetailsSchema
  .extend({
    carrier_id: z.uuid("Choose a carrier"),
    save_broker: z.boolean().default(false),
    stops: z.array(stopSchema).min(2, "Add at least a pickup and a delivery").max(20),
    vehicles: z.array(vehicleSchema).max(15).default([]),
    internal_note: optText(5000),
  })
  .superRefine((v, ctx) => {
    if (!v.stops.some((s) => s.stop_type === "pickup")) ctx.addIssue({ code: "custom", path: ["stops"], message: "Add at least one pickup" });
    if (!v.stops.some((s) => s.stop_type === "delivery")) ctx.addIssue({ code: "custom", path: ["stops"], message: "Add at least one delivery" });
    v.vehicles.forEach((veh, i) => {
      for (const key of ["pickup_sequence", "delivery_sequence"] as const) {
        const seq = veh[key];
        if (seq !== undefined && (seq > v.stops.length || v.stops[seq - 1]?.stop_type !== (key === "pickup_sequence" ? "pickup" : "delivery"))) {
          ctx.addIssue({ code: "custom", path: ["vehicles", i, key], message: `Choose a ${key === "pickup_sequence" ? "pickup" : "delivery"} stop` });
        }
      }
    });
  });

export type LoadCreateInput = z.input<typeof loadCreateSchema>;

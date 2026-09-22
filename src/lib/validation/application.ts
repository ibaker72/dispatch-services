/**
 * Carrier application schemas.
 *
 * Each step has a `strict` schema (required fields; used to complete a step
 * and on final submission) and a `draft` schema (types and lengths only; used
 * for autosave so partially filled steps can be saved). The same schemas run
 * in the browser (React Hook Form) and on the server (source of truth).
 *
 * We never collect Social Security numbers, full EINs or bank credentials.
 */
import { z } from "zod";
import { EQUIPMENT_KEYS } from "@/config/business";
import { US_STATE_CODES } from "@/lib/utils";

// SSN (123-45-6789 / 123 45 6789) and full EIN (12-3456789) formats. ZIP+4
// codes (74103-1234) and phone numbers do not match.
const SENSITIVE_PATTERNS = [/\b\d{3}-\d{2}-\d{4}\b/, /\b\d{3} \d{2} \d{4}\b/, /\b\d{2}-\d{7}\b/];
export const containsSensitiveNumber = (s: string) => SENSITIVE_PATTERNS.some((re) => re.test(s));
const noSensitive = (s: string) => !containsSensitiveNumber(s);
const SENSITIVE_MESSAGE = "Please do not include Social Security numbers or full EINs.";

const text = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer`).refine(noSensitive, SENSITIVE_MESSAGE);
const reqText = (label: string, max = 200) => text(max).min(1, `${label} is required`);
const optText = (max = 200) => text(max).optional().or(z.literal(""));
const state = z.string().trim().toUpperCase().refine((v) => US_STATE_CODES.includes(v), "Choose a state");
const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address"));
const phoneField = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v.replace(/\D/g, "").length >= 10, "Enter a valid phone number with area code");
const num = (min: number, max: number, label: string) =>
  z.coerce.number({ message: `${label} must be a number` }).min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);
const optNum = (min: number, max: number, label: string) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), num(min, max, label).optional());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

/** Strips an "MC"/"DOT" prefix and punctuation; keeps digits only. */
export function normalizeAuthorityNumber(value: string): string {
  return value.replace(/^\s*(mc|mx|ff|usdot|dot)[\s#:-]*/i, "").replace(/[^\d]/g, "");
}

const authorityNumber = (label: string) =>
  z
    .string()
    .trim()
    .transform(normalizeAuthorityNumber)
    .pipe(z.string().regex(/^\d{1,8}$/, `Enter a valid ${label} (digits only)`));

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const TRAILER_TYPES = ["open_car_hauler", "enclosed_car_hauler", "wedge", "gooseneck", "flatbed", "dry_van", "box", "other"] as const;

// ---- Step 1: contact --------------------------------------------------------
export const contactStrict = z.object({
  fullName: reqText("Full name", 120),
  title: optText(80),
  email: emailField,
  phone: phoneField,
  preferredContact: z.enum(["phone", "email", "text"]).default("phone"),
});

// ---- Step 2: business & authority -------------------------------------------
export const businessStrict = z.object({
  legalName: reqText("Legal company name", 200),
  dbaName: optText(200),
  mcNumber: authorityNumber("MC number"),
  usdotNumber: authorityNumber("USDOT number"),
  einLast4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Enter only the last four digits of your EIN")
    .optional()
    .or(z.literal("")),
  yearsInBusiness: num(0, 100, "Years in business"),
  authorityActiveDate: isoDate.refine((d) => d <= new Date().toISOString().slice(0, 10), "Authority date cannot be in the future"),
  addressLine1: reqText("Street address", 200),
  addressLine2: optText(200),
  city: reqText("City", 100),
  state,
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code"),
});

// ---- Step 3: equipment ------------------------------------------------------
const truckStrict = z.object({
  unitNumber: optText(40),
  equipmentType: z.enum(EQUIPMENT_KEYS),
  year: optNum(1980, new Date().getFullYear() + 1, "Year"),
  make: optText(60),
  model: optText(60),
  vehicleCapacity: optNum(0, 20, "Vehicle capacity"),
  maxPayloadLbs: optNum(0, 200000, "Maximum payload"),
});
const trailerStrict = z.object({
  trailerType: z.enum(TRAILER_TYPES),
  lengthFt: optNum(1, 99, "Length"),
  vehicleCapacity: optNum(0, 20, "Vehicle capacity"),
  maxPayloadLbs: optNum(0, 200000, "Maximum payload"),
});
export const equipmentStrict = z
  .object({
    primaryEquipmentType: z.enum(EQUIPMENT_KEYS, { message: "Choose your primary equipment" }),
    additionalEquipmentTypes: z.array(z.enum(EQUIPMENT_KEYS)).max(4).default([]),
    truckCount: num(1, 500, "Number of trucks"),
    trucks: z.array(truckStrict).min(1, "Add at least one truck").max(50),
    trailers: z.array(trailerStrict).max(50).default([]),
    notes: optText(1000),
  })
  .superRefine((v, ctx) => {
    const units = v.trucks.map((t) => (t.unitNumber ?? "").trim().toLowerCase()).filter(Boolean);
    if (new Set(units).size !== units.length) ctx.addIssue({ code: "custom", path: ["trucks"], message: "Unit numbers must be unique" });
  });

// ---- Step 4: drivers --------------------------------------------------------
const driverStrict = z.object({
  fullName: reqText("Driver name", 120),
  email: z.union([emailField, z.literal("")]).optional(),
  phone: z.union([phoneField, z.literal("")]).optional(),
  isOwnerOperator: z.boolean().default(false),
});
export const driversStrict = z.object({ drivers: z.array(driverStrict).min(1, "Add at least one driver").max(50) });

// ---- Step 5: lanes ----------------------------------------------------------
const laneStrict = z.object({ originState: state, destinationState: state });
export const lanesStrict = z.object({
  homeBaseCity: reqText("Home base city", 100),
  homeBaseState: state,
  preferredStates: z.array(state).min(1, "Choose at least one preferred state").max(51),
  avoidStates: z.array(state).max(51).default([]),
  preferredLanes: z.array(laneStrict).max(20).default([]),
  notes: optText(1000),
});

// ---- Step 6: revenue & schedule ---------------------------------------------
export const preferencesStrict = z.object({
  minRatePerMile: num(0.5, 20, "Minimum rate per mile"),
  desiredWeeklyGross: optNum(0, 100000, "Desired weekly gross"),
  daysAvailable: z.array(z.enum(DAYS)).min(1, "Choose at least one day"),
  maxDeadheadMiles: optNum(0, 1000, "Maximum deadhead"),
  notes: optText(1000),
});

// ---- Step 7: factoring ------------------------------------------------------
export const factoringStrict = z
  .object({
    status: z.enum(["none", "factoring", "quick_pay"], { message: "Tell us how you get paid" }),
    companyName: optText(200),
    noaAvailable: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.status === "factoring" && !v.companyName) ctx.addIssue({ code: "custom", path: ["companyName"], message: "Factoring company name is required" });
  });

// ---- Step 8: documents ------------------------------------------------------
export const documentsStrict = z.object({
  insuranceExpirationDate: isoDate.refine((d) => d >= new Date().toISOString().slice(0, 10), "Your insurance appears to be expired"),
});

// ---- Step 9: consent & custom questions -------------------------------------
export const consentStrict = z.object({
  accurate: z.literal(true, { message: "Please confirm the information is accurate" }),
  authorizeVerification: z.literal(true, { message: "Please authorize us to verify your authority and insurance" }),
  acknowledgeDisclosure: z.literal(true, { message: "Please acknowledge the dispatch relationship disclosure" }),
  agreeTerms: z.literal(true, { message: "Please accept the terms and privacy policy" }),
  custom: z.record(z.string(), text(2000)).default({}),
});

export const APPLICATION_STEPS = [
  { number: 1, key: "contact", title: "Contact information", schema: contactStrict },
  { number: 2, key: "business", title: "Business and authority", schema: businessStrict },
  { number: 3, key: "equipment", title: "Equipment", schema: equipmentStrict },
  { number: 4, key: "drivers", title: "Drivers", schema: driversStrict },
  { number: 5, key: "lanes", title: "Lanes and regions", schema: lanesStrict },
  { number: 6, key: "preferences", title: "Revenue and schedule", schema: preferencesStrict },
  { number: 7, key: "factoring", title: "Factoring", schema: factoringStrict },
  { number: 8, key: "documents", title: "Documents", schema: documentsStrict },
  { number: 9, key: "consent", title: "Review and submit", schema: consentStrict },
] as const;

export type StepKey = (typeof APPLICATION_STEPS)[number]["key"];
export const STEP_KEYS = APPLICATION_STEPS.map((s) => s.key) as StepKey[];

export function stepByKey(key: StepKey) {
  return APPLICATION_STEPS.find((s) => s.key === key)!;
}

/**
 * Draft (autosave) validation: any JSON object of bounded size whose string
 * values contain no SSN-like data. Field-level rules apply when a step is
 * completed.
 */
export const draftStepSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 60_000, "This step is too large to save")
  .refine((v) => noSensitive(JSON.stringify(v)), SENSITIVE_MESSAGE);

export const SUBMISSION_CONSENT_VERSION = "application-consent-2026-09";

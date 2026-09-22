/**
 * Central business configuration.
 *
 * Edit the values below (or override them at runtime from Dashboard →
 * Settings → Business profile) instead of editing individual pages. Values in
 * square brackets are placeholders; the site renders them as-is until real
 * values are provided, and the admin dashboard warns while any remain.
 *
 * Do not add licenses, authority numbers, insurance details, testimonials or
 * performance statistics here unless they are real and verifiable.
 */
import { z } from "zod";

export const EQUIPMENT_KEYS = ["car_hauler", "hotshot", "box_truck", "dry_van"] as const;
export type EquipmentKey = (typeof EQUIPMENT_KEYS)[number];

const placeholderOr = <T extends z.ZodType>(schema: T) => z.union([schema, z.string().regex(/^\[[A-Z0-9 _-]+\]$/)]);

export const businessConfigSchema = z.object({
  brandName: z.string().min(1).max(80),
  legalEntity: z.string().min(1).max(160),
  email: placeholderOr(z.email()),
  phone: z.string().min(1).max(40),
  address: z.string().min(1).max(200),
  websiteUrl: placeholderOr(z.url()),
  serviceArea: z.literal("United States"),
  equipment: z.object({
    primary: z.enum(EQUIPMENT_KEYS),
    secondary: z.array(z.enum(EQUIPMENT_KEYS)),
  }),
  pricing: z.object({
    /** Default percentage plan, as a decimal string (0.07 = 7%). */
    defaultPercentage: z.string().regex(/^0\.\d{1,4}$/),
    /** Optional flat plan, dollars per active truck per week. */
    flatWeeklyPerTruck: z.string().regex(/^\d+\.\d{2}$/),
  }),
  /**
   * The company's own operating authority. The dispatch service does not need
   * or claim one. Leave null unless real, active numbers exist — they are only
   * displayed when both are set and `hasOperatingAuthority` is true.
   */
  authority: z.object({
    hasOperatingAuthority: z.boolean(),
    usdotNumber: z.string().regex(/^\d{1,8}$/).nullable(),
    mcNumber: z.string().regex(/^\d{1,8}$/).nullable(),
  }),
  leaseOn: z.object({
    /** Informational only; the real gate is LEASE_ON_OPERATIONS_ENABLED plus the compliance checklist. */
    status: z.literal("disabled"),
    waitlistEnabled: z.boolean(),
  }),
  operations: z.object({
    timezone: z.string(),
    /** Written notice required to end service. Mirrors the service agreement; requires attorney review. */
    cancellationNoticeDays: z.number().int().min(0).max(90),
    invoiceDueDays: z.number().int().min(0).max(60),
  }),
  /** Shown on invoices for manual payment. Leave null until real details exist. */
  manualPayment: z.object({
    checkPayableTo: z.string().nullable(),
    mailingAddress: z.string().nullable(),
    achInstructions: z.string().nullable(),
  }),
});

export type BusinessConfig = z.infer<typeof businessConfigSchema>;

export const business: BusinessConfig = {
  brandName: "[BUSINESS NAME]",
  legalEntity: "[LEGAL ENTITY]",
  email: "[EMAIL]",
  phone: "[PHONE]",
  address: "[ADDRESS]",
  websiteUrl: "[DOMAIN]",
  serviceArea: "United States",
  equipment: {
    primary: "car_hauler",
    secondary: ["hotshot", "box_truck", "dry_van"],
  },
  pricing: {
    defaultPercentage: "0.07",
    flatWeeklyPerTruck: "300.00",
  },
  authority: {
    hasOperatingAuthority: false,
    usdotNumber: null,
    mcNumber: null,
  },
  leaseOn: {
    status: "disabled",
    waitlistEnabled: true,
  },
  operations: {
    timezone: "America/Chicago",
    cancellationNoticeDays: 14,
    invoiceDueDays: 7,
  },
  manualPayment: {
    checkPayableTo: null,
    mailingAddress: null,
    achInstructions: null,
  },
};

export function isPlaceholder(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\[[A-Z0-9 _-]+\]$/.test(value.trim());
}

/** Fields that still contain placeholder values (shown as a warning to admins). */
export function placeholderFields(config: BusinessConfig = business): string[] {
  const fields: Array<[string, string]> = [
    ["brandName", config.brandName],
    ["legalEntity", config.legalEntity],
    ["email", config.email],
    ["phone", config.phone],
    ["address", config.address],
    ["websiteUrl", config.websiteUrl],
  ];
  return fields.filter(([, v]) => isPlaceholder(v)).map(([k]) => k);
}

/** USDOT/MC are displayed only when the company really holds authority and both numbers are set. */
export function displayableAuthority(config: BusinessConfig = business): { usdot: string; mc: string } | null {
  const { hasOperatingAuthority, usdotNumber, mcNumber } = config.authority;
  if (!hasOperatingAuthority || !usdotNumber || !mcNumber) return null;
  return { usdot: usdotNumber, mc: mcNumber };
}

export function percentLabel(decimal: string): string {
  const value = Number(decimal) * 100;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0+$/, "")}%`;
}

export const EQUIPMENT_LABELS: Record<EquipmentKey, string> = {
  car_hauler: "Car hauler",
  hotshot: "Hotshot",
  box_truck: "Box truck",
  dry_van: "Dry van",
};

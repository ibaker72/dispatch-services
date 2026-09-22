import { z } from "zod";
import { US_STATE_CODES } from "@/lib/utils";

export const trimmed = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer`);
export const requiredText = (label: string, max = 200) => trimmed(max).min(1, `${label} is required`);
export const optionalText = (max = 200) =>
  trimmed(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address"));

export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v.replace(/\D/g, "").length >= 10, "Enter a valid phone number with area code");

export const stateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => US_STATE_CODES.includes(v), "Choose a state");

/** Bot protection fields present on every public form. */
export const botFields = {
  company_website: z.string().max(200).optional(),
  started_at: z.coerce.number().int().optional(),
};

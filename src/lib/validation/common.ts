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

/** HTML form helpers: FormData delivers strings, "on" for checked boxes and "" for empty fields. */
export const formBool = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
export const formNumber = (min: number, max: number, label: string) =>
  z.preprocess(emptyToUndefined, z.coerce.number({ message: `${label} must be a number` }).min(min, `${label} must be at least ${min}`).max(max, `${label} is too large`));
export const formOptionalNumber = (min: number, max: number, label: string) => formNumber(min, max, label).optional();
export const formMoney = (label: string, min = 0) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, `${label} must be a dollar amount like 1250.00`)
      .refine((v) => Number(v) >= min, `${label} must be at least ${min}`),
  );
export const formOptionalUuid = z.preprocess(emptyToUndefined, z.uuid().optional());
export const formOptionalText = (max = 500) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
export const formDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
export const formOptionalDate = z.preprocess(emptyToUndefined, formDate.optional());

/** Bot protection fields present on every public form. */
export const botFields = {
  company_website: z.string().max(200).optional(),
  started_at: z.coerce.number().int().optional(),
};

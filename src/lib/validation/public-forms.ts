import { z } from "zod";
import { botFields, emailSchema, optionalText, phoneSchema, requiredText } from "./common";

export const CONTACT_TOPICS = [
  { value: "dispatch", label: "Dispatch service for my carrier" },
  { value: "pricing", label: "Pricing question" },
  { value: "support", label: "Existing client support" },
  { value: "lease_on", label: "Lease-on program" },
  { value: "other", label: "Something else" },
] as const;

export const contactSchema = z.object({
  name: requiredText("Name", 120),
  email: emailSchema,
  phone: z.union([phoneSchema, z.literal("")]).optional(),
  topic: z.enum(CONTACT_TOPICS.map((t) => t.value) as [string, ...string[]], { message: "Choose a topic" }),
  message: requiredText("Message", 4000).min(10, "Please add a little more detail"),
  ...botFields,
});
export type ContactInput = z.input<typeof contactSchema>;

export const waitlistSchema = z.object({
  full_name: requiredText("Full name", 120),
  email: emailSchema,
  phone: z.union([phoneSchema, z.literal("")]).optional(),
  city: optionalText(100),
  state: z.string().trim().toUpperCase().max(2).optional(),
  cdl_class: z.enum(["A", "B", "none"]).optional(),
  years_experience: z.coerce.number().int().min(0).max(60).optional(),
  equipment_interest: z.enum(["car_hauler", "hotshot", "box_truck", "dry_van"]).optional(),
  owns_truck: z.enum(["yes", "no"]).optional(),
  message: optionalText(2000),
  consent: z.literal(true, { message: "Please confirm you understand the program is not available yet" }),
  ...botFields,
});
export type WaitlistInput = z.input<typeof waitlistSchema>;

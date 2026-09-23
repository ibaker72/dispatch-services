import type { Enums } from "@/lib/db/database.types";

export const DOCUMENT_TYPE_LABELS: Record<Enums<"document_type">, string> = {
  w9: "W-9",
  certificate_of_insurance: "Certificate of insurance",
  operating_authority: "Operating authority",
  notice_of_assignment: "Notice of assignment",
  dispatch_agreement: "Signed dispatch agreement",
  limited_power_of_attorney: "Limited power of attorney",
  rate_confirmation: "Rate confirmation",
  bill_of_lading: "Bill of lading",
  proof_of_delivery: "Proof of delivery",
  vehicle_inspection_report: "Vehicle inspection report",
  gate_pass: "Gate pass / release",
  lumper_receipt: "Lumper receipt",
  scale_ticket: "Scale ticket",
  driver_license: "Driver license",
  medical_card: "Medical card",
  truck_registration: "Truck registration",
  trailer_registration: "Trailer registration",
  other: "Other document",
};

/** Document types a carrier or dispatcher can attach to a load. */
export const LOAD_DOCUMENT_TYPES = [
  "rate_confirmation",
  "bill_of_lading",
  "proof_of_delivery",
  "vehicle_inspection_report",
  "gate_pass",
  "lumper_receipt",
  "scale_ticket",
  "other",
] as const satisfies ReadonlyArray<Enums<"document_type">>;

/** Document types kept on the carrier's company file. */
export const CARRIER_DOCUMENT_TYPES = [
  "w9",
  "certificate_of_insurance",
  "operating_authority",
  "notice_of_assignment",
  "truck_registration",
  "trailer_registration",
  "driver_license",
  "medical_card",
  "other",
] as const satisfies ReadonlyArray<Enums<"document_type">>;

export const APPLICATION_STATUS_LABELS: Record<Enums<"application_status">, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  information_requested: "Information requested",
  approved: "Approved",
  declined: "Declined",
  onboarding: "Onboarding",
  active: "Active",
  inactive: "Inactive",
};

export const CHARGE_TYPE_LABELS: Record<Enums<"charge_type">, string> = {
  detention: "Detention",
  layover: "Layover",
  tonu: "Truck ordered not used (TONU)",
  lumper_reimbursement: "Lumper reimbursement",
  other: "Other accessorial",
};

export const PAYMENT_METHOD_LABELS: Record<Enums<"payment_method">, string> = {
  stripe: "Card / bank (online)",
  ach: "ACH transfer",
  check: "Check",
  wire: "Wire transfer",
  zelle: "Zelle",
  other: "Other",
};

export const TASK_PRIORITY_LABELS: Record<Enums<"task_priority">, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

export const SUPPORT_CATEGORIES = {
  general: "General question",
  load: "A specific load",
  documents: "Documents",
  billing: "Billing or invoices",
  portal: "Portal access",
  cancellation: "Cancel dispatch service",
} as const;

export const FACTORING_LABELS: Record<string, string> = {
  unknown: "Not provided",
  none: "Paid directly by brokers",
  factoring: "Uses a factoring company",
  quick_pay: "Broker quick pay",
};

export const TRAILER_TYPE_LABELS: Record<string, string> = {
  open_car_hauler: "Open car hauler",
  enclosed_car_hauler: "Enclosed car hauler",
  wedge: "Wedge",
  gooseneck: "Gooseneck",
  flatbed: "Flatbed",
  dry_van: "Dry van",
  box: "Box",
  other: "Other",
};

export const DAY_LABELS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

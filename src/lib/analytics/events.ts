/**
 * Analytics event catalog. Only events and properties listed here are ever
 * sent. Property values must be short enum-like strings, small integers or
 * booleans; anything that looks like personal or business-identifying data
 * (names, emails, phone numbers, MC/DOT numbers, VINs, document names,
 * dollar amounts) is dropped even if a caller passes it by mistake.
 */

type PropSpec = "token" | "int" | "bool";

export const ANALYTICS_EVENTS = {
  cta_clicked: { cta: "token", location: "token" },
  application_started: { source: "token" },
  application_step_completed: { step: "int", step_key: "token" },
  application_submitted: { equipment_type: "token", fleet_size: "token" },
  contact_submitted: { topic: "token" },
  login_completed: { method: "token", audience: "token" },
  carrier_onboarding_completed: {},
  load_approved: { via: "token" },
  load_rejected: { via: "token" },
  invoice_created: { source: "token" },
  invoice_paid: { method: "token" },
  lease_on_waitlist_signup: {},
} as const satisfies Record<string, Record<string, PropSpec>>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps<E extends AnalyticsEvent> = {
  [K in keyof (typeof ANALYTICS_EVENTS)[E]]?: (typeof ANALYTICS_EVENTS)[E][K] extends "int"
    ? number
    : (typeof ANALYTICS_EVENTS)[E][K] extends "bool"
      ? boolean
      : string;
};

const TOKEN = /^[a-z][a-z0-9_:-]{0,47}$/;
const LOOKS_SENSITIVE = [
  /@/, // emails
  /\d{4,}/, // phone numbers, MC/DOT numbers, amounts, ZIPs
  /[A-HJ-NPR-Z0-9]{11,17}/i, // VIN-like
  /\.(pdf|png|jpe?g|webp|heic)$/i, // file names
  /\$/, // money
];

export function sanitizeEventProperties<E extends AnalyticsEvent>(
  event: E,
  props: Record<string, unknown> = {},
): Record<string, string | number | boolean> {
  const spec = ANALYTICS_EVENTS[event] as Record<string, PropSpec>;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, type] of Object.entries(spec)) {
    const value = props[key];
    if (value === undefined || value === null) continue;
    if (type === "int" && Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100) {
      out[key] = value as number;
    } else if (type === "bool" && typeof value === "boolean") {
      out[key] = value;
    } else if (type === "token" && typeof value === "string" && TOKEN.test(value) && !LOOKS_SENSITIVE.some((re) => re.test(value))) {
      out[key] = value;
    }
  }
  return out;
}

/** Buckets fleet size so exact counts are not sent. */
export function fleetSizeBucket(trucks: number | null | undefined): string {
  if (!trucks || trucks < 1) return "unknown";
  if (trucks === 1) return "1";
  if (trucks <= 3) return "2_3";
  if (trucks <= 10) return "4_10";
  return "11_plus";
}

/** Strips query strings and fragments (which may carry tokens) from URLs before sending. */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    // Replace UUIDs in paths so record identifiers are not collected.
    const path = u.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
    return `${u.origin}${path}`;
  } catch {
    return undefined;
  }
}

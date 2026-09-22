/**
 * Sentry data scrubbing. Applied in beforeSend / beforeBreadcrumb for the
 * browser, server and edge SDKs. Removes credentials, cookies, query strings
 * and any field that may hold personal or business-identifying data.
 */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|session|api[_-]?key|signature|ssn|ein|tax|mc_?number|usdot|dot_?number|vin|email|phone|address|account|routing|bank|card|iban|name|ip_?address|user_?agent|body_markdown|form_data/i;

const SENSITIVE_VALUE = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, // email
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /\b(sk|pk|rk|whsec)_(live|test)_[A-Za-z0-9]+/g, // Stripe keys
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // US phone
  /\b[A-HJ-NPR-Z0-9]{17}\b/g, // VIN
  /\b\d{6,}\b/g, // long numbers (MC/DOT/account)
];

export function scrubString(value: string): string {
  return SENSITIVE_VALUE.reduce((acc, re) => acc.replace(re, "[redacted]"), value);
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function stripQuery(url: unknown): unknown {
  if (typeof url !== "string") return url;
  const index = url.search(/[?#]/);
  return index === -1 ? url : url.slice(0, index);
}

interface ScrubbableEvent {
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: Record<string, string>; data?: unknown };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: Array<{ data?: Record<string, unknown>; message?: string }>;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    event.request.url = stripQuery(event.request.url) as string | undefined;
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      const allowed = ["content-type", "accept", "x-request-id"];
      event.request.headers = Object.fromEntries(
        Object.entries(event.request.headers).filter(([k]) => allowed.includes(k.toLowerCase())),
      );
    }
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  if (event.message) event.message = scrubString(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubString(ex.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubString(crumb.message);
    if (crumb.data) {
      crumb.data = scrubValue(crumb.data) as Record<string, unknown>;
      if (crumb.data.url) crumb.data.url = stripQuery(crumb.data.url);
    }
  }
  return event;
}

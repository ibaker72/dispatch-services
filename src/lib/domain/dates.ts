/** Calendar helpers evaluated in the business timezone (not the server's). */

function partsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** YYYY-MM-DD of the given instant in the business timezone. */
export function localDate(date: Date, timeZone: string): string {
  const { year, month, day } = partsInZone(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** Monday (ISO week start) of the week containing `date`, in the business timezone. */
export function weekStart(date: Date, timeZone: string): string {
  const { weekday } = partsInZone(date, timeZone);
  return addDays(localDate(date, timeZone), -(WEEKDAY_INDEX[weekday] ?? 0));
}

export function previousWeekStart(date: Date, timeZone: string): string {
  return addDays(weekStart(date, timeZone), -7);
}

export function formatDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "—";
  const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnly ? new Date(`${value}T12:00:00Z`) : new Date(value);
  // Calendar dates are zone-less; timestamps are shown in the business timezone.
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: dateOnly ? "UTC" : "America/Chicago", ...opts }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, timeZone = "America/Chicago"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

export function daysUntil(isoDate: string, today: string): number {
  const a = Date.parse(`${isoDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** Minutes the zone is ahead of UTC at the given instant (e.g. -300 for CDT). */
function zoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant) / 60_000);
}

/**
 * Converts a wall-clock value from <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"),
 * interpreted in `timeZone`, to an ISO instant. Handles DST transitions.
 */
export function zonedLocalToIso(local: string, timeZone: string): string {
  const wall = Date.parse(`${local.slice(0, 16)}:00Z`);
  if (Number.isNaN(wall)) throw new RangeError("invalid local date-time");
  let instant = wall - zoneOffsetMinutes(wall, timeZone) * 60_000;
  const corrected = wall - zoneOffsetMinutes(instant, timeZone) * 60_000;
  if (corrected !== instant) instant = corrected;
  return new Date(instant).toISOString();
}

/** ISO instant → "YYYY-MM-DDTHH:mm" wall-clock value in `timeZone` (for datetime-local inputs). */
export function isoToZonedLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Short zone name for labels, e.g. "CDT". */
export function zoneAbbreviation(timeZone: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

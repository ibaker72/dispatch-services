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
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC", ...opts }).format(date);
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

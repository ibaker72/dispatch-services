/**
 * Helpers for building PostgREST filters from user input.
 * `.or()` filters are strings, so search input must never carry filter syntax.
 */
export function searchTerm(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const cleaned = raw.replace(/[^\p{L}\p{N}\s@.\-']/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned.length >= 2 ? cleaned : null;
}

/** `.or()` expression matching `term` against several text columns with ILIKE. */
export function ilikeAny(columns: string[], term: string): string {
  const pattern = `*${term.replace(/[*,()"\\]/g, "")}*`;
  return columns.map((c) => `${c}.ilike.${pattern}`).join(",");
}

export const PAGE_SIZE = 25;

export function pageParam(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
}

export function pageRange(page: number, size = PAGE_SIZE): [number, number] {
  return [(page - 1) * size, page * size - 1];
}

export function oneOf<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return allowed.includes(v as T) ? (v as T) : undefined;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Keeps only the first value of each search param. */
export function flatParams(sp: RawSearchParams): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

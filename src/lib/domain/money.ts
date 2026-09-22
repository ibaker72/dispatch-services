/**
 * Exact money arithmetic using integer cents (bigint). Currency is never
 * computed with floating point. Rounding matches PostgreSQL's numeric
 * round(): half away from zero.
 */

export type Cents = bigint;

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Integer division rounding half away from zero. */
export function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Parses a decimal amount ("1234.5", "0.07", 99) to a scaled integer with `scale` decimals. */
export function toScaled(value: string | number | bigint | null | undefined, scale: number): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  if (typeof value === "bigint") return value * 10n ** BigInt(scale);
  const text = typeof value === "number" ? numberToPlainString(value) : value.trim().replace(/,/g, "");
  const match = DECIMAL.exec(text);
  if (!match) throw new RangeError(`not a decimal amount: ${String(value)}`);
  const [, sign, whole, fraction = ""] = match;
  const digits = BigInt(whole + fraction.padEnd(scale, "0").slice(0, scale));
  const extra = fraction.slice(scale);
  // Round half away from zero on the discarded digits.
  const roundUp = extra.length > 0 && Number(extra[0]) >= 5;
  const magnitude = roundUp ? digits + 1n : digits;
  return sign ? -magnitude : magnitude;
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite amount: ${value}`);
  // Values from PostgREST numeric columns have at most a handful of decimals;
  // toFixed(10) avoids exponent notation and preserves them exactly.
  return value.toFixed(10).replace(/\.?0+$/, "");
}

export function toCents(value: string | number | null | undefined): Cents {
  return toScaled(value, 2);
}

export function centsToDecimal(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Percentage given as a decimal fraction ("0.07" = 7%) to basis points of a basis point (1/10000). */
export function rateToTenThousandths(rate: string | number): bigint {
  return toScaled(rate, 4);
}

/** amount × rate, rounded to cents. */
export function applyRate(amount: Cents, rate: string | number): Cents {
  return divRoundHalfAwayFromZero(amount * rateToTenThousandths(rate), 10_000n);
}

export function sumCents(values: Array<Cents>): Cents {
  return values.reduce((acc, v) => acc + v, 0n);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function formatCents(cents: Cents): string {
  // Safe: formatting a two-decimal string converted to Number for display only.
  return usd.format(Number(centsToDecimal(cents)));
}

export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatCents(toCents(value));
}

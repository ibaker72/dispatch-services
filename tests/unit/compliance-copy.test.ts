/**
 * Public and carrier-facing copy must never make prohibited claims:
 * "licensed dispatcher" / FMCSA dispatch licenses, income or load guarantees,
 * broker or shipper-solicitation language, invented social proof or
 * statistics. Mentions are allowed only in explicitly negated sentences
 * (e.g. "We do not guarantee rates").
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { business, displayableAuthority } from "@/config/business";
import { JOBS } from "@/lib/jobs/registry";

const ROOTS = ["src/content", "src/app/(marketing)", "src/app/(auth)", "src/app/portal", "src/components/marketing", "src/lib/email/templates.ts"];

function files(p: string): string[] {
  const full = path.join(process.cwd(), p);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full).flatMap((e) => files(path.join(p, e)));
}

/** Source text without comments, with JSX entities decoded, split into sentences. */
function sentences(file: string): string[] {
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/&[lr]dquo;|&quot;/g, '"')
    .replace(/&rsquo;|&apos;/g, "'")
    .replace(/\{" "\}/g, " ");
  return text.split(/(?<=[.!?])\s+|\n\s*\n|[<>]/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const NEGATION = /\b(not|never|no|don't|doesn't|won't|cannot|without|nor|neither|avoid)\b/i;

const MUST_BE_NEGATED: Array<[string, RegExp]> = [
  ["licensed dispatcher", /licensed\s+dispatch(er|ing|ers)?\b/i],
  ["dispatch license", /dispatch(er|ing)?\s+licen[sc]e/i],
  ["FMCSA licensing of dispatch", /FMCSA[\s-]+(licensed|certified|approved)|licen[sc]es? (from|by) (the )?FMCSA/i],
  ["guarantees", /\bguarantee[ds]?\b/i],
  ["broker identity", /\bwe are (a|an|your)\s+(freight\s+)?broker/i],
  ["shipper solicitation", /\bsolicit\w*\b/i],
];

const NEVER: Array<[string, RegExp]> = [
  ["testimonials or social proof", /\b(testimonials?|trusted by|as seen (on|in)|five[- ]star|5[- ]star|#1 )/i],
  ["income claims", /\b(earn|make|take home|gross)\w*\s+(up to\s+|over\s+|more than\s+)?\$\s?\d/i],
  ["percentage improvement statistics", /\b\d{1,3}\s?%\s+(more|higher|increase|better|less deadhead)/i],
  ["invented counters", /\b\d[\d,]*\+?\s+(carriers|trucks|loads|drivers|customers)\s+(served|dispatched|booked|trust|helped)/i],
];

describe("prohibited-claim detectors", () => {
  const flagged = (sentence: string) =>
    MUST_BE_NEGATED.some(([, re]) => re.test(sentence) && !NEGATION.test(sentence)) || NEVER.some(([, re]) => re.test(sentence));
  it.each([
    "We are a licensed dispatcher.",
    "Our FMCSA-licensed dispatch team books loads.",
    "Guaranteed $8,000 weekly gross!",
    "Drivers earn $10,000 a month with us.",
    "Trusted by 500+ carriers.",
    "1,200 loads booked last year.",
    "Get 30% more revenue per mile.",
    "We are your freight broker.",
    "We solicit freight from shippers nationwide.",
  ])("flags %s", (sentence) => expect(flagged(sentence)).toBe(true));
  it.each(["We do not guarantee rates or income.", "We are not a freight broker.", "We never solicit freight from shippers."])("allows %s", (sentence) =>
    expect(flagged(sentence)).toBe(false),
  );
});

describe("public and carrier-facing copy", () => {
  const all = ROOTS.flatMap(files).filter((f) => /\.(tsx?|md)$/.test(f));

  it("covers the marketing site, auth pages, portal and email templates", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(MUST_BE_NEGATED)("mentions of %s appear only in negated sentences", (_label, pattern) => {
    const offenders = all.flatMap((f) => sentences(f).filter((s) => pattern.test(s) && !NEGATION.test(s)).map((s) => `${path.relative(process.cwd(), f)}: ${s.slice(0, 160)}`));
    expect(offenders).toEqual([]);
  });

  it.each(NEVER)("contains no %s", (_label, pattern) => {
    const offenders = all.flatMap((f) => sentences(f).filter((s) => pattern.test(s)).map((s) => `${path.relative(process.cwd(), f)}: ${s.slice(0, 160)}`));
    expect(offenders).toEqual([]);
  });

  it("the public site states the dispatch relationship: not a broker, paid only by carriers", () => {
    const disclosure = fs.readFileSync("src/app/(marketing)/dispatch-disclosure/page.tsx", "utf8");
    expect(disclosure).toMatch(/not a freight broker/i);
    expect(disclosure).toMatch(/brokers, shippers or factoring companies/i);
    const footer = fs.readFileSync("src/components/marketing/site-footer.tsx", "utf8");
    expect(footer).toMatch(/relationship|disclosure/i);
  });
});

describe("company authority and lease-on defaults", () => {
  it("never displays authority numbers unless real ones are configured", () => {
    expect(business.authority.hasOperatingAuthority).toBe(false);
    expect(business.authority.usdotNumber).toBeNull();
    expect(business.authority.mcNumber).toBeNull();
    expect(displayableAuthority()).toBeNull();
    expect(displayableAuthority({ ...business, authority: { hasOperatingAuthority: false, usdotNumber: "1234567", mcNumber: "123456" } })).toBeNull();
  });

  it("keeps lease-on operations disabled by default", () => {
    expect(business.leaseOn.status).toBe("disabled");
    const example = fs.readFileSync(".env.example", "utf8");
    expect(example).toMatch(/^LEASE_ON_OPERATIONS_ENABLED=false$/m);
  });
});

describe("scheduled jobs", () => {
  it("vercel.json schedules exactly the registered jobs with matching cron expressions", () => {
    const config = JSON.parse(fs.readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    const scheduled = Object.fromEntries(config.crons.map((c) => [c.path.replace("/api/cron/", ""), c.schedule]));
    expect(scheduled).toEqual(Object.fromEntries(Object.entries(JOBS).map(([k, v]) => [k, v.schedule])));
  });
});

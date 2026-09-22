/**
 * Verifies WCAG 2.1 contrast for the design-token pairs used in the UI.
 * Text pairs need 4.5:1 (AA normal text); UI component / focus pairs 3:1.
 * Usage: pnpm check:contrast
 */
import fs from "node:fs";

const css = fs.readFileSync("src/app/globals.css", "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

const white = "#ffffff";
const color = (name: string) => (name === "white" ? white : tokens[name]!);

const pairs: Array<[fg: string, bg: string, min: number, use: string]> = [
  ["navy-900", "paper", 4.5, "headings / body on page"],
  ["steel-900", "paper", 4.5, "body text"],
  ["steel-700", "paper", 4.5, "secondary text"],
  ["steel-600", "paper", 4.5, "muted text"],
  ["steel-600", "white", 4.5, "muted text on cards"],
  ["steel-600", "paper-2", 4.5, "muted text on tinted sections"],
  ["paper", "navy-900", 4.5, "text on dark sections"],
  ["steel-300", "navy-900", 4.5, "muted text on dark sections"],
  ["accent", "navy-900", 4.5, "accent text on dark"],
  ["navy-900", "accent", 4.5, "primary CTA label"],
  ["white", "navy-900", 4.5, "navy button label"],
  ["accent-ink", "paper", 4.5, "accent text on light"],
  ["accent-ink", "accent-soft", 4.5, "accent badge"],
  ["navy-700", "white", 4.5, "links"],
  ["success", "success-soft", 4.5, "success badge"],
  ["warning", "warning-soft", 4.5, "warning badge"],
  ["danger", "danger-soft", 4.5, "danger badge"],
  ["danger", "white", 4.5, "error text"],
  ["info", "info-soft", 4.5, "info badge"],
  ["navy-600", "paper", 3, "focus ring on light"],
  ["navy-600", "white", 3, "focus ring on cards"],
  ["accent", "navy-900", 3, "focus ring on dark"],
  ["steel-500", "white", 3, "input borders"],
];

let failed = 0;
for (const [fg, bg, min, use] of pairs) {
  const r = ratio(color(fg), color(bg));
  const ok = r >= min;
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"} ${fg} on ${bg}: ${r.toFixed(2)}:1 (min ${min}) — ${use}`);
}
if (failed) {
  console.error(`\n${failed} contrast pair(s) below WCAG AA`);
  process.exit(1);
}
console.log("\nAll design-token pairs meet WCAG AA.");

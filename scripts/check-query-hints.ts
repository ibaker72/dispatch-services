/**
 * PostgREST embed hints (`table!constraint_name(...)`) are plain strings, so
 * TypeScript cannot catch a misspelled constraint. This check compares every
 * hint used in src/ with the foreign keys in the generated database types.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const types = readFileSync("src/lib/db/database.types.ts", "utf8");
const known = new Set([...types.matchAll(/foreignKeyName: "([a-z0-9_]+)"/g)].map((m) => m[1]));

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(entry) && !full.endsWith("database.types.ts")) yield full;
  }
}

const problems: string[] = [];
for (const file of files("src")) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/[a-z_]+!([a-z0-9_]+)\(/g)) {
    if (m[1] === "inner" || m[1] === "left") continue; // join modifiers, not constraint names
    if (!known.has(m[1]!)) problems.push(`${file}: unknown foreign key hint "${m[1]}"`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Query hint check passed (${known.size} foreign keys known).`);

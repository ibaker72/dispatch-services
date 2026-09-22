import fs from "node:fs";
import path from "node:path";

/**
 * Loads `.local-stack/env` (written by scripts/local-stack/stack.mjs) into
 * process.env without overriding variables that are already set, so CI or a
 * developer can point tests at another database explicitly.
 */
export function loadLocalStackEnv(root = process.cwd()): void {
  const file = path.join(root, ".local-stack", "env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2];
  }
}

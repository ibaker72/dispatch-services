import { execFileSync } from "node:child_process";

/** Ensures the demo seed exists (idempotent). The local stack must already be running. */
export default async function globalSetup() {
  execFileSync("pnpm", ["-s", "seed"], { stdio: "inherit" });
}

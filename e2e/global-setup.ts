import { execFileSync } from "node:child_process";
import pg from "pg";
import { loadLocalStackEnv } from "../tests/support/env";

/**
 * Ensures the demo seed exists (idempotent) and clears login rate-limit
 * buckets left by earlier runs. The local stack must already be running.
 */
export default async function globalSetup() {
  loadLocalStackEnv();
  execFileSync("pnpm", ["-s", "seed"], { stdio: "inherit" });
  const url = process.env.DATABASE_URL;
  if (url && /@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query("delete from public.rate_limit_buckets");
    await client.end();
  }
}

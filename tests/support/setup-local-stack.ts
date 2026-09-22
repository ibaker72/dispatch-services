import { loadLocalStackEnv } from "./env";

loadLocalStackEnv();

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Start the local stack with `pnpm stack:start` (writes .local-stack/env) or export DATABASE_URL.",
  );
}

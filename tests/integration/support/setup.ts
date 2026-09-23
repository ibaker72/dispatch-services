import path from "node:path";
import { loadLocalStackEnv } from "../../support/env";

/**
 * Integration tests call the application's server modules directly against
 * the local Supabase-compatible stack, with development adapters.
 */
loadLocalStackEnv();
const root = process.cwd();
process.env.APP_ENV ??= "test";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
process.env.EMAIL_DRIVER ??= "outbox";
process.env.EMAIL_DEV_OUTBOX_DIR = path.join(root, ".local-stack", "test-outbox");
process.env.PAYMENTS_DRIVER ??= "mock";
process.env.STORAGE_DRIVER ??= "local";
process.env.LOCAL_STORAGE_DIR = path.join(root, ".local-stack", "test-storage");
process.env.LOCAL_STORAGE_SIGNING_SECRET ??= "integration-test-storage-secret";
process.env.MOCK_PAYMENTS_SECRET ??= "integration-test-mock-payments";
process.env.CRON_SECRET ??= "integration-test-cron-secret";

if (!process.env.DATABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Start the local stack first: pnpm stack:start");
}

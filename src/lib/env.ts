import "server-only";
import { z } from "zod";

/**
 * Server environment, validated lazily on first use so that `next build`
 * can run without every integration configured. Missing optional services
 * fall back to documented development adapters; production refuses the
 * development-only adapters outright.
 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  NEXT_PUBLIC_SITE_URL: optional,

  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,

  STORAGE_DRIVER: z.enum(["supabase", "local"]).default("supabase"),
  LOCAL_STORAGE_DIR: optional,
  LOCAL_STORAGE_SIGNING_SECRET: optional,

  EMAIL_DRIVER: z.enum(["resend", "outbox", "console"]).optional(),
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
  EMAIL_REPLY_TO: optional,
  EMAIL_DEV_OUTBOX_DIR: optional,
  ADMIN_NOTIFICATION_EMAILS: optional,

  PAYMENTS_DRIVER: z.enum(["stripe", "mock", "manual"]).optional(),
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  POSTHOG_API_KEY: optional,
  NEXT_PUBLIC_POSTHOG_KEY: optional,
  NEXT_PUBLIC_POSTHOG_HOST: optional,

  SENTRY_DSN: optional,
  NEXT_PUBLIC_SENTRY_DSN: optional,

  CRON_SECRET: optional,
  INNGEST_EVENT_KEY: optional,
  INNGEST_SIGNING_KEY: optional,

  RATE_LIMIT_SALT: optional,
  TURNSTILE_SECRET_KEY: optional,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optional,

  LEASE_ON_OPERATIONS_ENABLED: bool,
});

export type ServerEnv = z.infer<typeof schema> & {
  emailDriver: "resend" | "outbox" | "console";
  paymentsDriver: "stripe" | "mock" | "manual";
  isProduction: boolean;
};

let cached: ServerEnv | undefined;

export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

export function resolveEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = schema.parse(source);
  const isProduction = parsed.APP_ENV === "production";
  const emailDriver = parsed.EMAIL_DRIVER ?? (parsed.RESEND_API_KEY ? "resend" : "console");
  const paymentsDriver = parsed.PAYMENTS_DRIVER ?? (parsed.STRIPE_SECRET_KEY ? "stripe" : "manual");

  if (isProduction) {
    const problems: string[] = [];
    if (parsed.STORAGE_DRIVER === "local") problems.push("STORAGE_DRIVER=local is for development only");
    if (paymentsDriver === "mock") problems.push("PAYMENTS_DRIVER=mock is for development only");
    if (emailDriver === "outbox") problems.push("EMAIL_DRIVER=outbox is for development only");
    if (emailDriver === "resend" && !parsed.RESEND_API_KEY) problems.push("RESEND_API_KEY is required for EMAIL_DRIVER=resend");
    if (paymentsDriver === "stripe" && (!parsed.STRIPE_SECRET_KEY || !parsed.STRIPE_WEBHOOK_SECRET)) {
      problems.push("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required for Stripe payments");
    }
    if (!parsed.CRON_SECRET) problems.push("CRON_SECRET is required to protect scheduled endpoints");
    if (!parsed.RATE_LIMIT_SALT) problems.push("RATE_LIMIT_SALT is required");
    if (problems.length) throw new ConfigurationError(`Invalid production configuration: ${problems.join("; ")}`);
  }
  if (parsed.STORAGE_DRIVER === "local" && !parsed.LOCAL_STORAGE_SIGNING_SECRET && parsed.APP_ENV !== "test") {
    // A fixed development secret is acceptable only outside production (enforced above).
    parsed.LOCAL_STORAGE_SIGNING_SECRET = "local-development-storage-signing-secret";
  }
  return { ...parsed, emailDriver, paymentsDriver, isProduction };
}

export function serverEnv(): ServerEnv {
  cached ??= resolveEnv(process.env);
  return cached;
}

/** Throws a clear error when a required integration is missing at the point of use. */
export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = serverEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new ConfigurationError(`${String(key)} is not configured. See .env.example.`);
  }
  return value as NonNullable<ServerEnv[K]>;
}

export function adminNotificationEmails(): string[] {
  return (serverEnv().ADMIN_NOTIFICATION_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

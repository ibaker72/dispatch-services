import "server-only";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import type { z } from "zod";
import { WORKFLOW_HINT_MESSAGES } from "@/lib/domain/load-workflow";
import { ConfigurationError } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { RateLimitError } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/request";
import { siteUrl } from "@/lib/site-url";

export type FieldErrors = Record<string, string[]>;

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

interface DbErrorLike {
  message?: string;
  code?: string;
  hint?: string | null;
  details?: string | null;
}

/** Converts PostgREST / Postgres errors into safe, user-facing text. */
export function describeDbError(error: DbErrorLike): string {
  if (error.hint && WORKFLOW_HINT_MESSAGES[error.hint]) return WORKFLOW_HINT_MESSAGES[error.hint]!;
  switch (error.code) {
    case "42501":
      return "You do not have permission to do that.";
    case "P0002":
      return "That record was not found.";
    case "23505":
      return "That already exists.";
    case "23503":
      return "A related record is missing or belongs to someone else.";
    case "23514":
    case "22023":
    case "P0001":
      // Messages raised by our own triggers/functions are written for users.
      return error.message ?? "That change is not allowed.";
    case "PGRST116":
      return "That record was not found.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export class DbError extends Error {
  constructor(readonly original: DbErrorLike) {
    super(describeDbError(original));
    this.name = "DbError";
  }
}

/** Throws a DbError when a Supabase response carries an error. */
export function unwrap<T>(result: { data: T; error: DbErrorLike | null }): T {
  if (result.error) throw new DbError(result.error);
  return result.data;
}

export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  if (!isSameOriginRequest(h, [siteUrl()])) {
    throw new AppError("This request could not be verified. Refresh the page and try again.", "forbidden");
  }
}

function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Wraps a server action: verifies the request origin (CSRF defense in depth),
 * validates input with Zod, and converts known failures into ActionResult
 * errors. Unknown errors are reported (scrubbed) and replaced with a generic
 * message so internals never leak to the browser.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  handler: (data: z.output<S>) => Promise<T>,
  opts: { skipOriginCheck?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    if (!opts.skipOriginCheck) await assertSameOrigin();
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Please check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
    }
    return { ok: true, data: await handler(parsed.data) };
  } catch (error) {
    return toActionError(error);
  }
}

export function toActionError(error: unknown): { ok: false; error: string } {
  if (isNextControlFlow(error)) throw error;
  if (error instanceof AppError || error instanceof DbError || error instanceof RateLimitError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof ConfigurationError) {
    console.error("[config]", error.message);
    return { ok: false, error: "This feature is not configured yet. Please contact support." };
  }
  Sentry.captureException(error);
  console.error("[action] unexpected error", error instanceof Error ? error.message : error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** redirect()/notFound() throw special errors that must propagate. */
function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

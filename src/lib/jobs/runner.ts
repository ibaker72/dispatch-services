import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { Json } from "@/lib/db/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type JobResult = Record<string, number | string | boolean | null>;
export interface JobOutcome {
  status: "succeeded" | "failed" | "skipped";
  runKey: string;
  result?: JobResult;
  error?: string;
}

const STALE_RUN_MS = 30 * 60_000;

/**
 * Runs a job at most once per run key (e.g. "weekly-statements:2026-09-21").
 * A succeeded run is never repeated; a failed or abandoned run is retried.
 * Handlers must themselves be idempotent (email dedupe keys, unique task
 * keys), so a retry after a partial failure is safe.
 */
export async function runJob(jobKey: string, runKey: string, triggeredBy: "cron" | "manual", handler: () => Promise<JobResult>): Promise<JobOutcome> {
  const admin = createSupabaseAdminClient();
  const fullKey = `${jobKey}:${runKey}`;

  const { data: existing } = await admin.from("job_runs").select("id, status, attempts, started_at").eq("run_key", fullKey).maybeSingle();
  let runId: string;
  if (existing) {
    const stale = Date.now() - Date.parse(existing.started_at) > STALE_RUN_MS;
    if (existing.status === "succeeded" || existing.status === "skipped" || (existing.status === "running" && !stale)) {
      return { status: "skipped", runKey: fullKey };
    }
    const { data: claimed } = await admin
      .from("job_runs")
      .update({ status: "running", attempts: existing.attempts + 1, started_at: new Date().toISOString(), finished_at: null, error: null, triggered_by: triggeredBy })
      .eq("id", existing.id)
      .eq("status", existing.status)
      .select("id")
      .maybeSingle();
    if (!claimed) return { status: "skipped", runKey: fullKey };
    runId = claimed.id;
  } else {
    const { data: created, error } = await admin.from("job_runs").insert({ job_key: jobKey, run_key: fullKey, status: "running", triggered_by: triggeredBy }).select("id").single();
    if (error) {
      // Another invocation claimed the same run concurrently.
      if (error.code === "23505") return { status: "skipped", runKey: fullKey };
      throw new Error(`job_runs insert failed: ${error.message}`);
    }
    runId = created.id;
  }

  try {
    const result = await handler();
    await admin.from("job_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), result: result as Json }).eq("id", runId);
    return { status: "succeeded", runKey: fullKey, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { job: jobKey } });
    console.error(`[job:${jobKey}] failed`, message);
    await admin.from("job_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) }).eq("id", runId);
    return { status: "failed", runKey: fullKey, error: message };
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { JOBS } from "@/lib/jobs/registry";
import { runJob } from "@/lib/jobs/runner";
import { constantTimeEqual } from "@/lib/security/tokens";

/**
 * Scheduled job endpoint. Vercel Cron calls GET with
 * `Authorization: Bearer $CRON_SECRET`; any other scheduler can do the same.
 * Each job runs at most once per run key and records its outcome in job_runs.
 */
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  return constantTimeEqual(header, `Bearer ${secret}`);
}

async function handle(request: NextRequest, job: string) {
  const def = JOBS[job];
  if (!def) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const manual = request.nextUrl.searchParams.get("trigger") === "manual";
  const outcome = await runJob(job, await def.runKey(now), manual ? "manual" : "cron", () => def.handler(now));
  return NextResponse.json(outcome, { status: outcome.status === "failed" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  return handle(request, (await params).job);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  return handle(request, (await params).job);
}

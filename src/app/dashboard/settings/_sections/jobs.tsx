import { runJobNow } from "../actions";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/domain/dates";
import { JOBS } from "@/lib/jobs/registry";
import type { UserSupabaseClient } from "@/lib/supabase/server";

export async function JobsSection({ supabase, timezone }: { supabase: UserSupabaseClient; timezone: string }) {
  const { data: runs } = await supabase.from("job_runs").select("id, job_key, run_key, status, triggered_by, attempts, started_at, finished_at, result, error").order("started_at", { ascending: false }).limit(60);
  const last = new Map<string, NonNullable<typeof runs>[number]>();
  for (const r of runs ?? []) if (!last.has(r.job_key)) last.set(r.job_key, r);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Scheduled jobs</CardTitle>
        </CardHeader>
        <CardBody className="pb-0 text-sm text-steel-600">Schedules are defined in vercel.json (UTC). Every job is safe to run again: emails and tasks are de-duplicated.</CardBody>
        <Table caption="Scheduled jobs">
          <THead>
            <tr>
              <TH>Job</TH>
              <TH>Schedule (UTC)</TH>
              <TH>Last run</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {Object.entries(JOBS).map(([key, def]) => {
              const r = last.get(key);
              return (
                <TR key={key}>
                  <TD>
                    <span className="font-mono text-xs">{key}</span>
                    <div className="text-sm text-steel-700">{def.description}</div>
                  </TD>
                  <TD className="font-mono text-xs">{def.schedule}</TD>
                  <TD>
                    {r ? (
                      <>
                        <StatusBadge status={r.status} /> <span className="text-xs text-steel-600">{formatDateTime(r.started_at, timezone)}</span>
                        {r.error ? <div className="text-xs text-danger">{r.error.slice(0, 160)}</div> : null}
                      </>
                    ) : (
                      <span className="text-sm text-steel-600">Never</span>
                    )}
                  </TD>
                  <TD className="text-right">
                    <ActionForm action={runJobNow} submitLabel="Run now" pendingLabel="Running…" submitVariant="secondary" submitSize="sm" inline>
                      <input type="hidden" name="job" value={key} />
                    </ActionForm>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <Table caption="Recent job runs">
          <THead>
            <tr>
              <TH>Run</TH>
              <TH>Status</TH>
              <TH>Result</TH>
            </tr>
          </THead>
          <tbody>
            {(runs ?? []).map((r) => (
              <TR key={r.id}>
                <TD>
                  <span className="font-mono text-xs">{r.run_key}</span>
                  <div className="text-xs text-steel-600">
                    {formatDateTime(r.started_at, timezone)} · {r.triggered_by}
                    {r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}
                  </div>
                </TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
                <TD className="font-mono text-xs break-all text-steel-700">{r.error ? r.error.slice(0, 200) : JSON.stringify(r.result)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

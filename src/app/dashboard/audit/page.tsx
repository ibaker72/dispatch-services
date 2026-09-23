import { Download, ScrollText } from "lucide-react";
import { FilterTabs, Pagination } from "@/components/dashboard/filters";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth/session";
import { type RawSearchParams, flatParams, pageParam, pageRange, searchTerm } from "@/lib/db/query";
import { formatDateTime } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";
import { listStaff, staffLabel } from "@/lib/staff";

export const metadata = { title: "Audit log" };

function summarize(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const changes = (metadata as { changes?: Record<string, unknown> }).changes;
  const source = changes && typeof changes === "object" ? changes : (metadata as Record<string, unknown>);
  return Object.entries(source)
    .slice(0, 6)
    .map(([k, v]) => {
      if (Array.isArray(v) && v.length === 2) return `${k}: ${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("; ")
    .slice(0, 300);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff({ admin: true });
  const params = flatParams(await searchParams);
  const severity = params.severity === "security" || params.severity === "warning" ? params.severity : undefined;
  const q = searchTerm(params.q);
  const page = pageParam(params.page);
  const [from, to] = pageRange(page, 50);
  const { timezone } = await getOperationsSettings();

  let query = ctx.supabase
    .from("audit_events")
    .select("id, occurred_at, actor_id, actor_kind, action, entity_type, entity_id, severity, ip_address, metadata", { count: "exact" })
    .order("occurred_at", { ascending: false });
  if (severity) query = query.eq("severity", severity);
  if (q) query = query.ilike("action", `%${q.replace(/[%_]/g, "")}%`);
  const [{ data, count }, staff] = await Promise.all([query.range(from, to), listStaff(ctx.supabase)]);
  const names = new Map(staff.map((s) => [s.user_id, staffLabel(s)]));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of changes to carriers, loads, billing, settings and security events. Sensitive fields are redacted."
        actions={
          <a href={`/api/exports/audit${severity ? `?severity=${severity}` : ""}`} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-steel-300 bg-white px-3 text-sm font-semibold hover:bg-paper-2">
            <Download className="size-4" aria-hidden="true" /> CSV
          </a>
        }
      />
      <FilterTabs
        base="/dashboard/audit"
        params={{ ...params, severity }}
        name="severity"
        label="Severity"
        options={[
          { value: undefined, label: "All events" },
          { value: "security", label: "Security" },
          { value: "warning", label: "Warnings" },
        ]}
      />
      <form action="/dashboard/audit" method="get" role="search" className="mb-4 flex gap-2">
        {severity ? <input type="hidden" name="severity" value={severity} /> : null}
        <label className="flex-1">
          <span className="sr-only">Filter by action</span>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Filter by action, e.g. loads.update or auth.login"
            className="h-10 w-full rounded-md border border-steel-500 bg-white px-3 text-sm"
          />
        </label>
        <button type="submit" className="h-10 rounded-md border border-steel-300 bg-white px-4 text-sm font-semibold hover:bg-paper-2">
          Filter
        </button>
      </form>
      {data && data.length ? (
        <Card>
          <Table caption="Audit events">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Action</TH>
                <TH>Actor</TH>
                <TH>Details</TH>
              </tr>
            </THead>
            <tbody>
              {data.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-xs">{formatDateTime(e.occurred_at, timezone)}</TD>
                  <TD>
                    <span className="font-mono text-xs">{e.action}</span>
                    {e.severity !== "info" ? (
                      <Badge tone={e.severity === "security" ? "navy" : "warning"} className="ml-2">
                        {e.severity}
                      </Badge>
                    ) : null}
                    {e.entity_type ? <div className="text-xs text-steel-600">{e.entity_type}</div> : null}
                  </TD>
                  <TD className="text-sm">
                    {e.actor_id ? (names.get(e.actor_id) ?? `${e.actor_kind} ${e.actor_id.slice(0, 8)}`) : e.actor_kind}
                    {e.ip_address ? <div className="text-xs text-steel-600">{String(e.ip_address)}</div> : null}
                  </TD>
                  <TD className="max-w-md text-xs break-words text-steel-700">{summarize(e.metadata)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState icon={ScrollText} title="No matching events" />
      )}
      <Pagination base="/dashboard/audit" params={{ ...params, severity }} page={page} hasNext={(count ?? 0) > page * 50} total={count} />
    </>
  );
}

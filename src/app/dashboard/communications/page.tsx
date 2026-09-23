import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { retryEmail } from "./actions";
import { ActionForm } from "@/components/action-form";
import { FilterTabs, Pagination } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth/session";
import { PAGE_SIZE, type RawSearchParams, flatParams, pageParam, pageRange } from "@/lib/db/query";
import { formatDateTime } from "@/lib/domain/dates";
import { TEMPLATE_LABELS, type TemplateKey } from "@/lib/email/templates";
import { maskEmail } from "@/lib/email/send";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Communications" };

const VIEWS = { all: "All", email: "Emails", logged: "Calls, texts & notes", failed: "Failed delivery" } as const;

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const params = flatParams(await searchParams);
  const view = (params.view && params.view in VIEWS ? params.view : "all") as keyof typeof VIEWS;
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);
  const { timezone } = await getOperationsSettings();

  let query = ctx.supabase
    .from("communications")
    .select("id, channel, direction, subject, template_key, to_address, status, attempts, error, created_at, carrier_id, load_id, application_id, carriers(legal_name), loads(reference)", {
      count: "exact",
    })
    .order("created_at", { ascending: false });
  if (view === "email") query = query.eq("channel", "email").neq("status", "logged");
  if (view === "logged") query = query.eq("status", "logged");
  if (view === "failed") query = query.in("status", ["failed", "skipped"]);
  const { data, count } = await query.range(from, to);

  return (
    <>
      <PageHeader title="Communication history" description="Every automated email and every logged call, text or note. Email addresses are partially hidden in this list." />
      <FilterTabs
        base="/dashboard/communications"
        params={{ view: view === "all" ? undefined : view }}
        name="view"
        label="Communication views"
        options={Object.entries(VIEWS).map(([k, label]) => ({ value: k === "all" ? undefined : k, label }))}
      />
      {data && data.length ? (
        <Card>
          <Table caption="Communications">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Message</TH>
                <TH>Related to</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {data.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(c.created_at, timezone)}</TD>
                  <TD>
                    <span className="font-medium">{c.subject ?? (c.template_key ? TEMPLATE_LABELS[c.template_key as TemplateKey] : c.channel)}</span>
                    <div className="text-xs text-steel-600">
                      {c.channel} · {c.direction}
                      {c.to_address ? ` · to ${maskEmail(c.to_address)}` : ""}
                      {c.template_key ? ` · ${TEMPLATE_LABELS[c.template_key as TemplateKey] ?? c.template_key}` : ""}
                    </div>
                    {c.error ? <div className="text-xs text-danger">{c.error.slice(0, 160)}</div> : null}
                  </TD>
                  <TD className="text-sm">
                    {c.carrier_id && c.carriers ? (
                      <Link href={`/dashboard/carriers/${c.carrier_id}?tab=activity`} className="hover:underline">
                        {c.carriers.legal_name}
                      </Link>
                    ) : c.application_id ? (
                      <Link href={`/dashboard/applications/${c.application_id}`} className="hover:underline">
                        Application
                      </Link>
                    ) : (
                      "—"
                    )}
                    {c.load_id && c.loads ? (
                      <div>
                        <Link href={`/dashboard/loads/${c.load_id}`} className="text-xs hover:underline">
                          Load {c.loads.reference}
                        </Link>
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <StatusBadge status={c.status} />
                    {c.attempts > 1 ? <div className="text-xs text-steel-600">{c.attempts} attempts</div> : null}
                  </TD>
                  <TD className="text-right">
                    {c.status === "failed" ? (
                      <ActionForm action={retryEmail} submitLabel="Retry" submitVariant="secondary" submitSize="sm" inline>
                        <input type="hidden" name="id" value={c.id} />
                      </ActionForm>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState icon={MessageSquare} title="Nothing here yet" />
      )}
      <Pagination base="/dashboard/communications" params={{ view: view === "all" ? undefined : view }} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}

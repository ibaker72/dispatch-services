import { FileText } from "lucide-react";
import Link from "next/link";
import { DocumentReviewActions } from "@/components/dashboard/document-review";
import { FilterTabs, Pagination } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { isAdminRole, requireStaff } from "@/lib/auth/session";
import { PAGE_SIZE, type RawSearchParams, flatParams, pageParam, pageRange } from "@/lib/db/query";
import { addDays, daysUntil, formatDate, localDate } from "@/lib/domain/dates";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";
import type { DocumentRow } from "@/components/dashboard/document-table";

export const metadata = { title: "Documents" };

const VIEWS = {
  review: "Needs review",
  expiring: "Expiring in 30 days",
  expired: "Expired",
  rejected: "Rejected",
  all: "All current",
} as const;
type View = keyof typeof VIEWS;

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const admin = isAdminRole(ctx.staffRoles);
  const params = flatParams(await searchParams);
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "review";
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);
  const { timezone } = await getOperationsSettings();
  const today = localDate(new Date(), timezone);

  let query = ctx.supabase
    .from("documents")
    .select("id, doc_type, status, original_filename, size_bytes, expires_on, uploaded_at, review_note, carrier_id, carriers(legal_name), loads(reference), drivers(full_name), trucks(unit_number)", {
      count: "exact",
    })
    .is("deleted_at", null)
    .not("carrier_id", "is", null);
  if (view === "review") query = query.eq("status", "pending_review").order("uploaded_at");
  else if (view === "expiring") query = query.eq("status", "accepted").gte("expires_on", today).lte("expires_on", addDays(today, 30)).order("expires_on");
  else if (view === "expired") query = query.in("status", ["accepted", "expired"]).lt("expires_on", today).order("expires_on");
  else if (view === "rejected") query = query.eq("status", "rejected").order("uploaded_at", { ascending: false });
  else query = query.in("status", ["accepted", "pending_review"]).order("uploaded_at", { ascending: false });
  const { data, count } = await query.range(from, to);
  const docs = data ?? [];

  return (
    <>
      <PageHeader
        title="Documents"
        description="Review carrier uploads and track expiring insurance, licenses and registrations. Reminders go out automatically before documents expire."
      />
      <FilterTabs
        base="/dashboard/documents"
        params={{ ...params, view: view === "review" ? undefined : view }}
        name="view"
        label="Document views"
        options={Object.entries(VIEWS).map(([k, label]) => ({ value: k === "review" ? undefined : k, label }))}
      />
      {docs.length ? (
        <Card>
          <Table caption="Documents">
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Carrier</TH>
                <TH>Attached to</TH>
                <TH>Status</TH>
                <TH>Expires</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {docs.map((d) => {
                const days = d.expires_on ? daysUntil(d.expires_on, today) : null;
                return (
                  <TR key={d.id}>
                    <TD>
                      <span className="font-medium">{DOCUMENT_TYPE_LABELS[d.doc_type]}</span>
                      <div className="max-w-[14rem] truncate text-xs text-steel-600" title={d.original_filename}>
                        {d.original_filename} · uploaded {formatDate(d.uploaded_at)}
                      </div>
                      {d.review_note ? <div className="text-xs text-steel-700">Note: {d.review_note}</div> : null}
                    </TD>
                    <TD>
                      <Link href={`/dashboard/carriers/${d.carrier_id}?tab=documents`} className="underline-offset-2 hover:underline">
                        {d.carriers?.legal_name}
                      </Link>
                    </TD>
                    <TD className="text-sm">{d.loads ? `Load ${d.loads.reference}` : d.drivers ? `Driver ${d.drivers.full_name}` : d.trucks ? `Truck ${d.trucks.unit_number}` : "Company file"}</TD>
                    <TD>
                      <StatusBadge status={d.status} />
                    </TD>
                    <TD>
                      {d.expires_on ? (
                        <span className={days !== null && days < 0 ? "font-semibold text-danger" : days !== null && days <= 30 ? "font-semibold text-warning" : undefined}>
                          {formatDate(d.expires_on)}
                          {days !== null ? <span className="block text-xs">{days < 0 ? `${-days} days ago` : days === 0 ? "today" : `in ${days} days`}</span> : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <a
                          href={`/api/documents/${d.id}/download`}
                          className="inline-flex h-8 items-center rounded-md border border-steel-300 bg-white px-3 text-sm font-semibold text-navy-900 hover:bg-paper-2"
                        >
                          Download<span className="sr-only"> {DOCUMENT_TYPE_LABELS[d.doc_type]}</span>
                        </a>
                        <DocumentReviewActions doc={d as DocumentRow} canArchive={admin} />
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState icon={FileText} title={view === "review" ? "Nothing waiting for review" : "No documents in this view"}>
          {view === "expiring" ? "No accepted documents expire in the next 30 days." : null}
        </EmptyState>
      )}
      <Pagination base="/dashboard/documents" params={{ ...params, view: view === "review" ? undefined : view }} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}

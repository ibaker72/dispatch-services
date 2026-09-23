import { Inbox } from "lucide-react";
import Link from "next/link";
import { FilterTabs, Pagination, SearchForm } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EQUIPMENT_LABELS, type EquipmentKey } from "@/config/business";
import { requireStaff } from "@/lib/auth/session";
import type { Enums } from "@/lib/db/database.types";
import { PAGE_SIZE, type RawSearchParams, flatParams, ilikeAny, pageParam, pageRange, searchTerm } from "@/lib/db/query";
import { formatDate } from "@/lib/domain/dates";

export const metadata = { title: "Applications" };

const VIEWS: Record<string, { label: string; statuses: Array<Enums<"application_status">> }> = {
  review: { label: "Needs review", statuses: ["submitted", "under_review"] },
  info: { label: "Info requested", statuses: ["information_requested"] },
  onboarding: { label: "Approved / onboarding", statuses: ["approved", "onboarding"] },
  active: { label: "Active", statuses: ["active"] },
  declined: { label: "Declined", statuses: ["declined"] },
  inactive: { label: "Inactive", statuses: ["inactive"] },
  drafts: { label: "Unfinished drafts", statuses: ["draft"] },
};

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const params = flatParams(await searchParams);
  const view = params.view && VIEWS[params.view] ? params.view : "review";
  const q = searchTerm(params.q);
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);

  let query = ctx.supabase
    .from("carrier_applications")
    .select("id, status, legal_name, contact_name, email, mc_number, usdot_number, primary_equipment_type, truck_count, home_base_state, submitted_at, last_activity_at, current_step", {
      count: "exact",
    })
    .in("status", VIEWS[view]!.statuses);
  if (q) query = query.or(ilikeAny(["legal_name", "contact_name", "email", "mc_number", "usdot_number"], q));
  query = view === "drafts" ? query.order("last_activity_at", { ascending: false }) : query.order("submitted_at", { ascending: true, nullsFirst: false });
  const { data: apps, count } = await query.range(from, to);

  const { data: counts } = await ctx.supabase.from("carrier_applications").select("status").in("status", ["submitted", "under_review", "information_requested"]);
  const reviewCount = (counts ?? []).filter((c) => c.status !== "information_requested").length;
  const infoCount = (counts ?? []).length - reviewCount;

  const tabParams = { ...params, view: view === "review" ? undefined : view };
  return (
    <>
      <PageHeader
        title="Carrier applications"
        description="Review submitted applications, request missing information and approve carriers into onboarding. Oldest submissions are listed first."
      />
      <FilterTabs
        base="/dashboard/applications"
        params={tabParams}
        name="view"
        label="Application status"
        options={Object.entries(VIEWS).map(([key, v]) => ({
          value: key === "review" ? undefined : key,
          label: v.label,
          count: key === "review" ? reviewCount : key === "info" ? infoCount : null,
        }))}
      />
      <SearchForm action="/dashboard/applications" params={tabParams} placeholder="Search company, contact, email, MC or USDOT" />
      {apps && apps.length ? (
        <Card>
          <Table caption="Carrier applications">
            <THead>
              <tr>
                <TH>Company</TH>
                <TH>Equipment</TH>
                <TH>Home base</TH>
                <TH>MC / USDOT</TH>
                <TH>Status</TH>
                <TH>{view === "drafts" ? "Last activity" : "Submitted"}</TH>
              </tr>
            </THead>
            <tbody>
              {apps.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/dashboard/applications/${a.id}`} className="font-semibold text-navy-900 underline-offset-2 hover:underline">
                      {a.legal_name || "Unnamed draft"}
                    </Link>
                    <div className="text-xs text-steel-600">{a.contact_name ?? a.email ?? "No contact yet"}</div>
                  </TD>
                  <TD>
                    {a.primary_equipment_type ? EQUIPMENT_LABELS[a.primary_equipment_type as EquipmentKey] ?? a.primary_equipment_type : "—"}
                    {a.truck_count ? <div className="text-xs text-steel-600">{a.truck_count} truck{a.truck_count === 1 ? "" : "s"}</div> : null}
                  </TD>
                  <TD>{a.home_base_state ?? "—"}</TD>
                  <TD className="font-mono text-xs">
                    {a.mc_number ? `MC ${a.mc_number}` : "—"}
                    <br />
                    {a.usdot_number ? `DOT ${a.usdot_number}` : ""}
                  </TD>
                  <TD>
                    <StatusBadge status={a.status} />
                    {a.status === "draft" ? <div className="mt-1 text-xs text-steel-600">Step {a.current_step} of 9</div> : null}
                  </TD>
                  <TD>{formatDate(view === "drafts" ? a.last_activity_at : a.submitted_at)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState icon={Inbox} title={q ? "No applications match your search" : "No applications here"}>
          {view === "review" && !q ? "New submissions from the public application form will appear here." : "Try a different filter."}
        </EmptyState>
      )}
      <Pagination base="/dashboard/applications" params={tabParams} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}

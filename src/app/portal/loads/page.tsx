import { Route } from "lucide-react";
import { FilterTabs, Pagination } from "@/components/dashboard/filters";
import { LOAD_LIST_COLUMNS, type LoadRow, LoadsTable } from "@/components/dashboard/loads-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { PAGE_SIZE, type RawSearchParams, flatParams, pageParam, pageRange } from "@/lib/db/query";
import type { LoadStatus } from "@/lib/domain/load-workflow";

export const metadata = { title: "Loads" };

const VIEWS: Record<string, { label: string; statuses: LoadStatus[] }> = {
  decision: { label: "Awaiting decision", statuses: ["proposed"] },
  active: { label: "Approved & active", statuses: ["approved", "booked", "dispatched", "at_pickup", "loaded", "in_transit", "delivered", "paperwork_pending"] },
  completed: { label: "Completed", statuses: ["completed"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled"] },
};

export default async function PortalLoadsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireCarrierUser();
  const params = flatParams(await searchParams);
  const view = params.view && VIEWS[params.view] ? params.view : "active";
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);
  // RLS hides opportunities; carriers see loads only once they are proposed to them.
  const { data, count } = await ctx.supabase
    .from("loads")
    .select(LOAD_LIST_COLUMNS, { count: "exact" })
    .in("status", VIEWS[view]!.statuses)
    .order("created_at", { ascending: false })
    .range(from, to);
  const loads = (data ?? []) as unknown as LoadRow[];
  const tabParams = { view: view === "active" ? undefined : view };

  return (
    <>
      <PageHeader title="Loads" description="Loads your dispatcher found for you. You approve or reject every load before it is booked." />
      <FilterTabs base="/portal/loads" params={tabParams} name="view" label="Load views" options={Object.entries(VIEWS).map(([k, v]) => ({ value: k === "active" ? undefined : k, label: v.label }))} />
      {loads.length ? (
        <Card>
          <LoadsTable loads={loads} basePath="/portal/loads" showCarrier={false} audience="carrier" />
        </Card>
      ) : (
        <EmptyState icon={Route} title="No loads here" />
      )}
      <Pagination base="/portal/loads" params={tabParams} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}

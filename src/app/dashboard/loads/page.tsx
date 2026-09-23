import { Route } from "lucide-react";
import Link from "next/link";
import { FilterTabs, Pagination, SearchForm } from "@/components/dashboard/filters";
import { LOAD_LIST_COLUMNS, type LoadRow, LoadsTable } from "@/components/dashboard/loads-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { PAGE_SIZE, type RawSearchParams, flatParams, ilikeAny, isUuid, pageParam, pageRange, searchTerm } from "@/lib/db/query";
import { LOAD_STATUSES, type LoadStatus } from "@/lib/domain/load-workflow";

export const metadata = { title: "Loads" };

const VIEWS: Record<string, { label: string; statuses: LoadStatus[] }> = {
  open: { label: "Needs action", statuses: ["opportunity", "proposed", "approved"] },
  moving: { label: "Booked & moving", statuses: ["booked", "dispatched", "at_pickup", "loaded", "in_transit"] },
  delivered: { label: "Delivered / paperwork", statuses: ["delivered", "paperwork_pending"] },
  completed: { label: "Completed", statuses: ["completed"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled"] },
  all: { label: "All", statuses: [...LOAD_STATUSES] },
};

export default async function LoadsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const params = flatParams(await searchParams);
  const statusFilter = LOAD_STATUSES.find((s) => s === params.status);
  const view = params.view && VIEWS[params.view] ? params.view : statusFilter ? "all" : "open";
  const carrier = isUuid(params.carrier) ? params.carrier : undefined;
  const q = searchTerm(params.q);
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);

  let query = ctx.supabase
    .from("loads")
    .select(LOAD_LIST_COLUMNS, { count: "exact" })
    .in("status", statusFilter ? [statusFilter] : VIEWS[view]!.statuses)
    .order("created_at", { ascending: false });
  if (carrier) query = query.eq("carrier_id", carrier);
  if (q) query = query.or(ilikeAny(["reference", "broker_name", "broker_load_number", "commodity"], q));
  const [{ data, count }, carriers] = await Promise.all([
    query.range(from, to),
    ctx.supabase.from("carriers").select("id, legal_name").is("deleted_at", null).order("legal_name"),
  ]);
  const loads = (data ?? []) as unknown as LoadRow[];
  const tabParams = { ...params, view: view === "open" ? undefined : view, status: undefined };

  return (
    <>
      <PageHeader
        title="Loads"
        description="Every load belongs to one contracted carrier. Loads cannot be moved to another carrier; a load the carrier declines goes back to the broker."
        actions={
          <Link href="/dashboard/loads/new" className="inline-flex h-10 items-center rounded-md bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
            New load
          </Link>
        }
      />
      <FilterTabs base="/dashboard/loads" params={tabParams} name="view" label="Load status" options={Object.entries(VIEWS).map(([k, v]) => ({ value: k === "open" ? undefined : k, label: v.label }))} />
      <SearchForm
        action="/dashboard/loads"
        params={tabParams}
        placeholder="Search reference, broker, broker load # or commodity"
        selects={[{ name: "carrier", label: "Carrier", options: (carriers.data ?? []).map((c) => [c.id, c.legal_name]) }]}
      />
      {statusFilter ? <p className="mb-3 text-sm text-steel-600">Showing status: {statusFilter.replace("_", " ")}</p> : null}
      {loads.length ? (
        <Card>
          <LoadsTable loads={loads} basePath="/dashboard/loads" />
        </Card>
      ) : (
        <EmptyState icon={Route} title="No loads here" action={<Link href="/dashboard/loads/new" className="font-semibold underline">Create a load</Link>}>
          Loads can be created only for active carriers with an accepted service agreement and fee terms.
        </EmptyState>
      )}
      <Pagination base="/dashboard/loads" params={tabParams} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}

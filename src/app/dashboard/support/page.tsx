import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { FilterTabs, Pagination } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth/session";
import { PAGE_SIZE, type RawSearchParams, flatParams, pageParam, pageRange } from "@/lib/db/query";
import { formatDateTime } from "@/lib/domain/dates";
import { SUPPORT_CATEGORIES } from "@/lib/domain/labels";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Support requests" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const params = flatParams(await searchParams);
  const view = params.view === "closed" ? "closed" : "open";
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);
  const { timezone } = await getOperationsSettings();
  const { data, count } = await ctx.supabase
    .from("support_requests")
    .select("id, subject, category, status, created_at, carrier_id, carriers(legal_name), loads(reference)", { count: "exact" })
    .in("status", view === "open" ? ["open", "in_progress", "waiting_on_carrier"] : ["resolved", "closed"])
    .order("created_at", { ascending: view === "open" })
    .range(from, to);

  return (
    <>
      <PageHeader title="Support requests" description="Questions and requests carriers send from the portal, including cancellation requests." />
      <FilterTabs
        base="/dashboard/support"
        params={{ view: view === "open" ? undefined : view }}
        name="view"
        label="Support views"
        options={[
          { value: undefined, label: "Open" },
          { value: "closed", label: "Resolved & closed" },
        ]}
      />
      {data && data.length ? (
        <Card>
          <Table caption="Support requests">
            <THead>
              <tr>
                <TH>Request</TH>
                <TH>Carrier</TH>
                <TH>Received</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {data.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/dashboard/support/${r.id}`} className="font-semibold text-navy-900 hover:underline">
                      {r.subject}
                    </Link>
                    <div className="text-xs text-steel-600">
                      {SUPPORT_CATEGORIES[r.category as keyof typeof SUPPORT_CATEGORIES] ?? r.category}
                      {r.loads ? ` · Load ${r.loads.reference}` : ""}
                    </div>
                  </TD>
                  <TD>{r.carriers?.legal_name}</TD>
                  <TD>{formatDateTime(r.created_at, timezone)}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState icon={LifeBuoy} title={view === "open" ? "No open support requests" : "No closed requests yet"} />
      )}
      <Pagination base="/dashboard/support" params={{ view: view === "open" ? undefined : view }} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}

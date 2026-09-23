import { Building2 } from "lucide-react";
import Link from "next/link";
import { FilterTabs, Pagination, SearchForm } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth/session";
import { PAGE_SIZE, type RawSearchParams, flatParams, ilikeAny, oneOf, pageParam, pageRange, searchTerm } from "@/lib/db/query";
import { formatDate, localDate } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Carriers" };

const STATUSES = ["active", "onboarding", "inactive"] as const;

export default async function CarriersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const params = flatParams(await searchParams);
  const status = oneOf(params.status, STATUSES);
  const q = searchTerm(params.q);
  const page = pageParam(params.page);
  const [from, to] = pageRange(page);
  const { timezone } = await getOperationsSettings();
  const today = localDate(new Date(), timezone);

  let query = ctx.supabase
    .from("carriers")
    .select(
      "id, legal_name, dba_name, status, mc_number, usdot_number, home_base_city, home_base_state, insurance_expiration_date, authority_verification_status, cancellation_effective_date, trucks(count), dispatcher_assignments(is_primary, ended_at, profiles!dispatcher_assignments_dispatcher_id_fkey(full_name, email))",
      { count: "exact" },
    )
    .is("deleted_at", null)
    .is("dispatcher_assignments.ended_at", null)
    .order("legal_name");
  if (status) query = query.eq("status", status);
  if (q) query = query.or(ilikeAny(["legal_name", "dba_name", "mc_number", "usdot_number", "email"], q));
  const { data: carriers, count } = await query.range(from, to);

  return (
    <>
      <PageHeader
        title="Carriers"
        description={ctx.staffRoles.includes("dispatcher") && !ctx.staffRoles.includes("admin") && !ctx.grantsAllCarriers ? "Carriers assigned to you." : "Every carrier under a dispatch service agreement or in onboarding."}
      />
      <FilterTabs
        base="/dashboard/carriers"
        params={params}
        name="status"
        label="Carrier status"
        options={[{ value: undefined, label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))]}
      />
      <SearchForm action="/dashboard/carriers" params={params} placeholder="Search name, MC, USDOT or email" />
      {carriers && carriers.length ? (
        <Card>
          <Table caption="Carriers">
            <THead>
              <tr>
                <TH>Carrier</TH>
                <TH>Home base</TH>
                <TH>Trucks</TH>
                <TH>Primary dispatcher</TH>
                <TH>Insurance</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {carriers.map((c) => {
                const primary = c.dispatcher_assignments.find((a) => a.is_primary)?.profiles;
                const insuranceExpired = c.insurance_expiration_date ? c.insurance_expiration_date < today : false;
                return (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/dashboard/carriers/${c.id}`} className="font-semibold text-navy-900 underline-offset-2 hover:underline">
                        {c.legal_name}
                      </Link>
                      <div className="font-mono text-xs text-steel-600">
                        {[c.mc_number ? `MC ${c.mc_number}` : null, c.usdot_number ? `DOT ${c.usdot_number}` : null].filter(Boolean).join(" · ") || "No authority numbers"}
                      </div>
                    </TD>
                    <TD>{[c.home_base_city, c.home_base_state].filter(Boolean).join(", ") || "—"}</TD>
                    <TD>{c.trucks[0]?.count ?? 0}</TD>
                    <TD>{primary ? (primary.full_name ?? primary.email) : <span className="text-warning">Unassigned</span>}</TD>
                    <TD>
                      {c.insurance_expiration_date ? (
                        <span className={insuranceExpired ? "font-semibold text-danger" : undefined}>
                          {insuranceExpired ? "Expired " : ""}
                          {formatDate(c.insurance_expiration_date)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      <StatusBadge status={c.status} />
                      {c.authority_verification_status !== "verified" ? <div className="mt-1 text-xs text-warning">Authority {c.authority_verification_status}</div> : null}
                      {c.cancellation_effective_date ? <div className="mt-1 text-xs text-danger">Cancels {formatDate(c.cancellation_effective_date)}</div> : null}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState icon={Building2} title={q || status ? "No carriers match" : "No carriers yet"}>
          Carriers are created when an application is approved.{" "}
          <Link href="/dashboard/applications" className="font-semibold underline">
            Review applications
          </Link>
        </EmptyState>
      )}
      <Pagination base="/dashboard/carriers" params={params} page={page} hasNext={(count ?? 0) > page * PAGE_SIZE} total={count} />
    </>
  );
}

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityTab } from "./_tabs/activity";
import { BillingTab } from "./_tabs/billing";
import { DocumentsTab } from "./_tabs/documents";
import { FleetTab } from "./_tabs/fleet";
import { LoadsTab } from "./_tabs/loads";
import { OverviewTab } from "./_tabs/overview";
import { TeamTab } from "./_tabs/team";
import { TabNav } from "@/components/dashboard/tab-nav";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { isAdminRole, requireStaff } from "@/lib/auth/session";
import { type RawSearchParams, flatParams, isUuid, oneOf } from "@/lib/db/query";
import { formatDate } from "@/lib/domain/dates";

export const metadata = { title: "Carrier" };

const TABS = ["overview", "fleet", "documents", "loads", "billing", "team", "activity"] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  overview: "Overview",
  fleet: "Trucks & drivers",
  documents: "Documents",
  loads: "Loads",
  billing: "Billing",
  team: "Portal users",
  activity: "Activity",
};

export default async function CarrierDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tab = oneOf(flatParams(await searchParams).tab, TABS) ?? "overview";
  const ctx = await requireStaff();
  const { data: carrier } = await ctx.supabase.from("carriers").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!carrier) notFound();
  const admin = isAdminRole(ctx.staffRoles);

  const { count: pendingDocs } = await ctx.supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("carrier_id", id)
    .eq("status", "pending_review")
    .is("deleted_at", null);

  const props = { ctx, carrier, admin };
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/carriers" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Carriers
          </Link>
        }
        title={carrier.legal_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={carrier.status} />
            <span className="font-mono text-xs">
              {[carrier.mc_number ? `MC ${carrier.mc_number}` : null, carrier.usdot_number ? `USDOT ${carrier.usdot_number}` : null].filter(Boolean).join(" · ")}
            </span>
            {carrier.dba_name ? <span>DBA {carrier.dba_name}</span> : null}
          </span>
        }
        actions={
          carrier.status === "active" ? (
            <Link href={`/dashboard/loads/new?carrier=${carrier.id}`} className="inline-flex h-10 items-center rounded-md bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
              New load
            </Link>
          ) : null
        }
      />
      {carrier.cancellation_effective_date ? (
        <Alert tone="warning" title={`Cancellation requested — service ends ${formatDate(carrier.cancellation_effective_date)}`} className="mb-6">
          {carrier.cancellation_reason}
        </Alert>
      ) : null}
      <TabNav
        label="Carrier sections"
        current={tab}
        tabs={TABS.map((t) => ({
          key: t,
          label: TAB_LABELS[t],
          href: t === "overview" ? `/dashboard/carriers/${id}` : `/dashboard/carriers/${id}?tab=${t}`,
          count: t === "documents" ? pendingDocs : null,
        }))}
      />
      {tab === "overview" ? <OverviewTab {...props} /> : null}
      {tab === "fleet" ? <FleetTab {...props} /> : null}
      {tab === "documents" ? <DocumentsTab {...props} /> : null}
      {tab === "loads" ? <LoadsTab {...props} /> : null}
      {tab === "billing" ? <BillingTab {...props} /> : null}
      {tab === "team" ? <TeamTab {...props} /> : null}
      {tab === "activity" ? <ActivityTab {...props} /> : null}
    </>
  );
}

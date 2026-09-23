import Link from "next/link";
import { LOAD_LIST_COLUMNS, type LoadRow, LoadsTable } from "@/components/dashboard/loads-table";
import { OnboardingChecklist, parseOnboarding } from "@/components/onboarding-checklist";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { requireCarrierUser } from "@/lib/auth/session";
import { addDays, daysUntil, formatDate, localDate, weekStart } from "@/lib/domain/dates";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/labels";
import { ACTIVE_LOAD_STATUSES } from "@/lib/domain/load-workflow";
import { formatMoney } from "@/lib/domain/money";
import { formatMiles, formatRate } from "@/lib/domain/mileage";
import { weeklyPerformance } from "@/lib/reports/performance";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Carrier portal" };

export default async function PortalHome() {
  const ctx = await requireCarrierUser();
  const carrierId = ctx.membership.carrierId;
  const { timezone } = await getOperationsSettings();
  const today = localDate(new Date(), timezone);
  const week = weekStart(new Date(), timezone);

  const [proposed, active, invoices, expiring, dispatchers, onboarding, perf] = await Promise.all([
    ctx.supabase.from("loads").select(LOAD_LIST_COLUMNS).eq("status", "proposed").order("proposed_at"),
    ctx.supabase.from("loads").select(LOAD_LIST_COLUMNS).in("status", ACTIVE_LOAD_STATUSES).order("booked_at", { ascending: false }).limit(10),
    ctx.supabase.from("invoices").select("id, invoice_number, balance_due, due_date").eq("status", "open").order("due_date"),
    ctx.supabase
      .from("documents")
      .select("id, doc_type, expires_on")
      .eq("status", "accepted")
      .is("deleted_at", null)
      .not("expires_on", "is", null)
      .lte("expires_on", addDays(today, 30))
      .order("expires_on"),
    ctx.supabase
      .from("dispatcher_assignments")
      .select("is_primary, profiles!dispatcher_assignments_dispatcher_id_fkey(full_name, email, phone)")
      .eq("carrier_id", carrierId)
      .is("ended_at", null)
      .order("is_primary", { ascending: false }),
    ctx.membership.carrierStatus !== "active" ? ctx.supabase.rpc("get_carrier_onboarding", { p_carrier_id: carrierId }) : Promise.resolve({ data: null }),
    weeklyPerformance(ctx.supabase, week, carrierId),
  ]);
  const proposedLoads = (proposed.data ?? []) as unknown as LoadRow[];
  const activeLoads = (active.data ?? []) as unknown as LoadRow[];
  const week0 = perf[0];
  const owner = ctx.membership.role === "carrier_owner";
  const steps = parseOnboarding(onboarding.data);

  return (
    <>
      <PageHeader title={`Welcome${ctx.profile?.full_name ? `, ${ctx.profile.full_name.split(" ")[0]}` : ""}`} description="Your loads, documents and billing in one place. You decide which loads to take." />

      {ctx.membership.carrierStatus !== "active" ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Finish onboarding</CardTitle>
            <Link href="/portal/onboarding" className="text-sm font-semibold underline">
              Open onboarding
            </Link>
          </CardHeader>
          <CardBody>
            <OnboardingChecklist steps={steps.steps} />
          </CardBody>
        </Card>
      ) : null}

      {proposedLoads.length ? (
        <Alert tone="warning" title={`${proposedLoads.length} load${proposedLoads.length === 1 ? "" : "s"} waiting for your decision`} className="mb-6">
          {owner ? "Review the rate, lane and pickup window, then approve or pass. Nothing is booked without your approval." : "Your company owner approves or rejects proposed loads."}
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Completed loads this week" value={week0?.loads ?? 0} />
        <Stat label="Your gross this week" value={formatMoney(week0?.carrierGross ?? 0)} tone="carrier" hint="From completed loads" />
        <Stat label="Loaded rate per mile" value={formatRate(week0?.loadedRatePerMile)} hint={`${formatMiles(week0?.loadedMiles ?? 0)} loaded`} />
        <Stat label="Open invoices" value={formatMoney((invoices.data ?? []).reduce((a, i) => a + Number(i.balance_due ?? 0), 0))} tone="company" hint="Dispatch service fees" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Awaiting your decision</CardTitle>
            </CardHeader>
            {proposedLoads.length ? (
              <LoadsTable loads={proposedLoads} basePath="/portal/loads" showCarrier={false} audience="carrier" />
            ) : (
              <CardBody className="text-sm text-steel-600">No loads are waiting for you right now.</CardBody>
            )}
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Booked and moving</CardTitle>
              <Link href="/portal/loads" className="text-sm font-semibold underline">
                All loads
              </Link>
            </CardHeader>
            {activeLoads.length ? (
              <LoadsTable loads={activeLoads} basePath="/portal/loads" showCarrier={false} audience="carrier" />
            ) : (
              <CardBody className="text-sm text-steel-600">No active loads.</CardBody>
            )}
          </Card>
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your dispatcher</CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              {(dispatchers.data ?? []).length ? (
                <ul className="space-y-2">
                  {dispatchers.data!.map((d, i) => (
                    <li key={i}>
                      <span className="font-semibold">{d.profiles?.full_name ?? "Dispatcher"}</span>
                      {d.is_primary ? <span className="text-xs text-steel-600"> (primary)</span> : null}
                      {d.profiles?.phone ? <span className="block">{d.profiles.phone}</span> : null}
                      {d.profiles?.email ? <span className="block text-steel-600">{d.profiles.email}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-steel-600">A dispatcher will be assigned during onboarding.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Invoices due</CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              {(invoices.data ?? []).length ? (
                <ul className="space-y-2">
                  {invoices.data!.map((i) => (
                    <li key={i.id} className="flex justify-between gap-2">
                      <Link href={`/portal/billing/invoices/${i.id}`} className="underline">
                        {i.invoice_number}
                      </Link>
                      <span className={i.due_date && i.due_date < today ? "font-semibold text-danger" : undefined}>
                        {formatMoney(i.balance_due)} · due {formatDate(i.due_date)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-steel-600">Nothing due.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Documents expiring</CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              {(expiring.data ?? []).length ? (
                <ul className="space-y-2">
                  {expiring.data!.map((d) => {
                    const days = daysUntil(d.expires_on!, today);
                    return (
                      <li key={d.id} className="flex justify-between gap-2">
                        <span>{DOCUMENT_TYPE_LABELS[d.doc_type]}</span>
                        <span className={days < 0 ? "font-semibold text-danger" : "text-warning"}>{days < 0 ? "Expired" : `${days} days`}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-steel-600">Nothing expires in the next 30 days.</p>
              )}
              <Link href="/portal/documents" className="mt-3 inline-block font-semibold underline">
                Upload documents
              </Link>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

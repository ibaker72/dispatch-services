import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { LoadStatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { requireStaff } from "@/lib/auth/session";
import { addDays, daysUntil, formatDate, localDate, weekStart } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { formatMiles, formatRate } from "@/lib/domain/mileage";
import { getOperationsSettings } from "@/lib/settings";

type Metrics = Record<string, number | string | null>;

export default async function DashboardOverview({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireStaff();
  const { timezone } = await getOperationsSettings();
  const params = await searchParams;
  const current = weekStart(new Date(), timezone);
  const week = params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? weekStart(new Date(`${params.week}T12:00:00Z`), "UTC") : current;
  const today = localDate(new Date(), timezone);

  const [{ data }, proposed, expiring, overdue, myTasks] = await Promise.all([
    ctx.supabase.rpc("get_dashboard_metrics", { p_week_start: week }),
    ctx.supabase
      .from("loads")
      .select("id, reference, status, gross_rate, proposed_at, carriers(legal_name)")
      .eq("status", "proposed")
      .order("proposed_at", { ascending: true })
      .limit(5),
    ctx.supabase
      .from("documents")
      .select("id, doc_type, expires_on, carriers(id, legal_name)")
      .eq("status", "accepted")
      .is("deleted_at", null)
      .not("expires_on", "is", null)
      .lte("expires_on", addDays(today, 30))
      .order("expires_on")
      .limit(5),
    ctx.supabase
      .from("invoices")
      .select("id, invoice_number, balance_due, due_date, carriers(legal_name)")
      .eq("status", "open")
      .lt("due_date", today)
      .order("due_date")
      .limit(5),
    ctx.supabase
      .from("tasks")
      .select("id, title, due_at, priority")
      .eq("assigned_to", ctx.userId)
      .in("status", ["open", "in_progress"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(5),
  ]);
  const m = (data ?? {}) as Metrics;
  const n = (key: string) => Number(m[key] ?? 0).toLocaleString("en-US");

  return (
    <>
      <PageHeader
        title="Operations overview"
        description="Carrier revenue belongs to the carriers. Dispatch-company revenue is our fee income and is reported separately."
        actions={
          <nav aria-label="Week" className="flex items-center gap-1 text-sm">
            <Link className="inline-flex size-9 items-center justify-center rounded-md border border-steel-300 bg-white hover:bg-paper-2" href={`/dashboard?week=${addDays(week, -7)}`} aria-label="Previous week">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            <span className="px-2 font-medium text-navy-900">
              Week of {formatDate(week)}
              {week === current ? " (this week)" : ""}
            </span>
            <Link className="inline-flex size-9 items-center justify-center rounded-md border border-steel-300 bg-white hover:bg-paper-2" href={`/dashboard?week=${addDays(week, 7)}`} aria-label="Next week">
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </nav>
        }
      />

      <section aria-labelledby="ops-heading" className="mb-8">
        <h2 id="ops-heading" className="mb-3 text-sm font-semibold tracking-wide text-steel-600 uppercase">
          Operations
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Active carriers" value={n("active_carriers")} hint={`${n("onboarding_carriers")} onboarding`} />
          <Stat label="Active trucks" value={n("active_trucks")} />
          <Stat label="Trucks available now" value={n("trucks_available_now")} />
          <Stat label="Loads booked this week" value={n("loads_booked_this_week")} hint={`${n("loads_in_progress")} in progress`} />
          <Stat label="Awaiting carrier decision" value={n("loads_awaiting_carrier")} />
        </div>
      </section>

      <section aria-labelledby="carrier-rev-heading" className="mb-8">
        <h2 id="carrier-rev-heading" className="mb-3 text-sm font-semibold tracking-wide text-steel-600 uppercase">
          Carrier revenue &amp; performance — completed loads this week
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat tone="carrier" label="Carrier gross revenue" value={formatMoney(m.carrier_gross_revenue as number)} hint="Earned by carriers, not us" />
          <Stat tone="carrier" label="Avg loaded rate/mile" value={formatRate(m.avg_loaded_rate_per_mile as number | null)} />
          <Stat tone="carrier" label="Avg all-in rate/mile" value={formatRate(m.avg_all_in_rate_per_mile as number | null)} />
          <Stat tone="carrier" label="Loaded miles" value={formatMiles(m.loaded_miles as number)} />
          <Stat tone="carrier" label="Deadhead miles" value={formatMiles(m.deadhead_miles as number)} />
          <Stat tone="carrier" label="Deadhead %" value={m.deadhead_percentage === null || m.deadhead_percentage === undefined ? "—" : `${m.deadhead_percentage}%`} />
        </div>
      </section>

      <section aria-labelledby="company-rev-heading" className="mb-8">
        <h2 id="company-rev-heading" className="mb-3 text-sm font-semibold tracking-wide text-steel-600 uppercase">
          Dispatch-company revenue &amp; compliance
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat tone="company" label="Dispatch fees earned (week)" value={formatMoney(m.dispatch_fees_earned as number)} hint="Our revenue" />
          <Stat
            tone="company"
            label="Outstanding invoices"
            value={formatMoney(m.outstanding_invoices_amount as number)}
            hint={`${n("outstanding_invoices_count")} open · ${n("overdue_invoices_count")} overdue`}
          />
          <Stat tone="warning" label="Documents expiring ≤ 30 days" value={n("documents_expiring_30_days")} />
          <Stat label="Applications to review" value={n("applications_pending_review")} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Loads awaiting carrier approval</CardTitle>
            <Link href="/dashboard/loads?status=proposed" className="text-sm font-medium text-navy-700 underline">
              View all
            </Link>
          </CardHeader>
          <CardBody>
            {proposed.data?.length ? (
              <ul className="divide-y divide-steel-100">
                {proposed.data.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/dashboard/loads/${l.id}`} className="font-medium text-navy-700 underline">
                      {l.reference}
                    </Link>
                    <span className="flex-1 truncate text-steel-600">{l.carriers?.legal_name}</span>
                    <LoadStatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing waiting on carriers">Proposed loads appear here until the carrier approves or rejects them.</EmptyState>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Documents expiring soon</CardTitle>
            <Link href="/dashboard/documents" className="text-sm font-medium text-navy-700 underline">
              View all
            </Link>
          </CardHeader>
          <CardBody>
            {expiring.data?.length ? (
              <ul className="divide-y divide-steel-100">
                {expiring.data.map((d) => {
                  const days = daysUntil(d.expires_on!, today);
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <Link href={`/dashboard/carriers/${d.carriers?.id}`} className="truncate font-medium text-navy-700 underline">
                        {d.carriers?.legal_name}
                      </Link>
                      <span className="text-steel-600">{d.doc_type.replaceAll("_", " ")}</span>
                      <span className={days < 0 ? "font-semibold text-danger" : "text-warning"}>{days < 0 ? `Expired ${-days}d ago` : `${days} days`}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No documents expiring in the next 30 days" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Overdue invoices</CardTitle>
            <Link href="/dashboard/billing?tab=invoices" className="text-sm font-medium text-navy-700 underline">
              Billing
            </Link>
          </CardHeader>
          <CardBody>
            {overdue.data?.length ? (
              <ul className="divide-y divide-steel-100">
                {overdue.data.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/dashboard/billing/invoices/${i.id}`} className="font-medium text-navy-700 underline">
                      {i.invoice_number}
                    </Link>
                    <span className="flex-1 truncate text-steel-600">{i.carriers?.legal_name}</span>
                    <span className="tabular-nums">{formatMoney(i.balance_due)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No overdue invoices" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>My open tasks</CardTitle>
            <Link href="/dashboard/tasks" className="text-sm font-medium text-navy-700 underline">
              All tasks
            </Link>
          </CardHeader>
          <CardBody>
            {myTasks.data?.length ? (
              <ul className="divide-y divide-steel-100">
                {myTasks.data.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate">{t.title}</span>
                    <span className="text-steel-600">{t.due_at ? formatDate(t.due_at) : "No due date"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No open tasks assigned to you" />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

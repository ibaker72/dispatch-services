import { Truck } from "lucide-react";
import Link from "next/link";
import { FilterTabs, SearchForm } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EQUIPMENT_LABELS, type EquipmentKey } from "@/config/business";
import { requireStaff } from "@/lib/auth/session";
import { type RawSearchParams, flatParams, ilikeAny, searchTerm } from "@/lib/db/query";
import { formatDate, formatDateTime, localDate } from "@/lib/domain/dates";
import { ACTIVE_LOAD_STATUSES } from "@/lib/domain/load-workflow";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Trucks and drivers" };

export default async function FleetPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff();
  const params = flatParams(await searchParams);
  const view = params.view === "drivers" ? "drivers" : params.view === "availability" ? "availability" : "trucks";
  const q = searchTerm(params.q);
  const { timezone } = await getOperationsSettings();
  const today = localDate(new Date(), timezone);
  const nowIso = new Date().toISOString();

  const tabs = (
    <FilterTabs
      base="/dashboard/fleet"
      params={{ ...params, view: view === "trucks" ? undefined : view }}
      name="view"
      label="Fleet views"
      options={[
        { value: undefined, label: "Trucks" },
        { value: "drivers", label: "Drivers" },
        { value: "availability", label: "Availability" },
      ]}
    />
  );
  const header = (
    <PageHeader title="Trucks and drivers" description="Equipment and drivers across the carriers you can access. Each truck belongs to exactly one carrier." />
  );

  if (view === "availability") {
    const { data } = await ctx.supabase
      .from("driver_availability")
      .select("id, status, available_from, available_until, location_city, location_state, notes, carrier_id, carriers(legal_name), drivers(full_name), trucks(unit_number, equipment_type)")
      .or(`available_until.is.null,available_until.gt.${nowIso}`)
      .order("available_from")
      .limit(200);
    return (
      <>
        {header}
        {tabs}
        {data && data.length ? (
          <Card>
            <Table caption="Driver availability">
              <THead>
                <tr>
                  <TH>Driver</TH>
                  <TH>Carrier</TH>
                  <TH>Truck</TH>
                  <TH>Window</TH>
                  <TH>Location</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {data.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-medium">{a.drivers?.full_name}</TD>
                    <TD>
                      <Link href={`/dashboard/carriers/${a.carrier_id}?tab=fleet`} className="hover:underline">
                        {a.carriers?.legal_name}
                      </Link>
                    </TD>
                    <TD>
                      {a.trucks ? `${a.trucks.unit_number} · ${EQUIPMENT_LABELS[a.trucks.equipment_type as EquipmentKey] ?? a.trucks.equipment_type}` : "—"}
                    </TD>
                    <TD>
                      {formatDateTime(a.available_from, timezone)}
                      <div className="text-xs text-steel-600">{a.available_until ? `until ${formatDateTime(a.available_until, timezone)}` : "open-ended"}</div>
                    </TD>
                    <TD>{[a.location_city, a.location_state].filter(Boolean).join(", ") || "—"}</TD>
                    <TD>
                      <Badge tone={a.status === "available" ? "success" : "neutral"}>{a.status === "available" ? "Available" : a.status === "home_time" ? "Home time" : "Unavailable"}</Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <EmptyState icon={Truck} title="No availability posted">
            Carriers post availability in their portal, or add it from a carrier&apos;s Trucks &amp; drivers tab.
          </EmptyState>
        )}
      </>
    );
  }

  if (view === "drivers") {
    let query = ctx.supabase.from("drivers").select("id, full_name, phone, status, license_expiration, medical_card_expiration, carrier_id, carriers(legal_name)").order("full_name").limit(300);
    if (q) query = query.or(ilikeAny(["full_name", "phone", "email"], q));
    const { data } = await query;
    return (
      <>
        {header}
        {tabs}
        <SearchForm action="/dashboard/fleet" params={{ ...params }} placeholder="Search drivers" />
        <Card>
          <Table caption="Drivers">
            <THead>
              <tr>
                <TH>Driver</TH>
                <TH>Carrier</TH>
                <TH>License expires</TH>
                <TH>Medical card</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {(data ?? []).map((d) => (
                <TR key={d.id}>
                  <TD className="font-medium">
                    {d.full_name}
                    <div className="text-xs font-normal text-steel-600">{d.phone ?? ""}</div>
                  </TD>
                  <TD>
                    <Link href={`/dashboard/carriers/${d.carrier_id}?tab=fleet`} className="hover:underline">
                      {d.carriers?.legal_name}
                    </Link>
                  </TD>
                  <TD className={d.license_expiration && d.license_expiration < today ? "font-semibold text-danger" : undefined}>{formatDate(d.license_expiration)}</TD>
                  <TD className={d.medical_card_expiration && d.medical_card_expiration < today ? "font-semibold text-danger" : undefined}>{formatDate(d.medical_card_expiration)}</TD>
                  <TD>
                    <StatusBadge status={d.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      </>
    );
  }

  let query = ctx.supabase
    .from("trucks")
    .select("id, unit_number, equipment_type, year, make, model, status, vehicle_capacity, carrier_id, carriers(legal_name, status), loads(id, reference, status)")
    .in("loads.status", ACTIVE_LOAD_STATUSES)
    .order("unit_number")
    .limit(300);
  if (q) query = query.or(ilikeAny(["unit_number", "make", "model"], q));
  const { data: trucks } = await query;
  const rows = trucks ?? [];
  const inUse = rows.filter((t) => t.loads.length > 0).length;
  return (
    <>
      {header}
      {tabs}
      <SearchForm action="/dashboard/fleet" params={{ ...params }} placeholder="Search unit, make or model" />
      <Card>
        <CardHeader>
          <CardTitle>
            {rows.filter((t) => t.status === "active").length} active trucks · {inUse} on a load
          </CardTitle>
        </CardHeader>
        <Table caption="Trucks">
          <THead>
            <tr>
              <TH>Unit</TH>
              <TH>Carrier</TH>
              <TH>Equipment</TH>
              <TH>Current load</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((t) => (
              <TR key={t.id}>
                <TD className="font-medium">
                  {t.unit_number}
                  <div className="text-xs font-normal text-steel-600">{[t.year, t.make, t.model].filter(Boolean).join(" ")}</div>
                </TD>
                <TD>
                  <Link href={`/dashboard/carriers/${t.carrier_id}?tab=fleet`} className="hover:underline">
                    {t.carriers?.legal_name}
                  </Link>
                </TD>
                <TD>
                  {EQUIPMENT_LABELS[t.equipment_type as EquipmentKey] ?? t.equipment_type}
                  {t.vehicle_capacity ? <div className="text-xs text-steel-600">{t.vehicle_capacity} vehicles</div> : null}
                </TD>
                <TD>
                  {t.loads[0] ? (
                    <Link href={`/dashboard/loads/${t.loads[0].id}`} className="hover:underline">
                      {t.loads[0].reference}
                    </Link>
                  ) : (
                    <span className="text-steel-600">Available</span>
                  )}
                </TD>
                <TD>
                  <StatusBadge status={t.status} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

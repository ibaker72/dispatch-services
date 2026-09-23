import { FormDialog } from "@/components/action-form";
import { AvailabilityForm, DriverForm, TrailerForm, TruckForm } from "@/components/fleet/fleet-forms";
import { AvailabilityList, DriversTable, TrailersTable, TrucksTable } from "@/components/fleet/fleet-tables";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireCarrierUser } from "@/lib/auth/session";
import { localDate, zoneAbbreviation } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Trucks and availability" };

export default async function PortalFleetPage() {
  const ctx = await requireCarrierUser();
  const carrierId = ctx.membership.carrierId;
  const owner = ctx.membership.role === "carrier_owner";
  const { timezone } = await getOperationsSettings();
  const today = localDate(new Date(), timezone);
  const [trucks, trailers, drivers, availability] = await Promise.all([
    ctx.supabase.from("trucks").select("*").eq("carrier_id", carrierId).order("unit_number"),
    ctx.supabase.from("trailers").select("*").eq("carrier_id", carrierId).order("created_at"),
    ctx.supabase.from("drivers").select("*").eq("carrier_id", carrierId).order("full_name"),
    ctx.supabase
      .from("driver_availability")
      .select("*, drivers(full_name), trucks(unit_number)")
      .eq("carrier_id", carrierId)
      .or(`available_until.is.null,available_until.gt.${new Date().toISOString()}`)
      .order("available_from"),
  ]);
  const truckOptions = (trucks.data ?? []).map((t) => ({ id: t.id, unit_number: t.unit_number }));
  const activeDrivers = (drivers.data ?? []).filter((d) => d.status === "active");

  return (
    <>
      <PageHeader title="Trucks and availability" description="Keep your equipment and driver availability current so your dispatcher looks for the right loads." />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Availability</CardTitle>
            {activeDrivers.length ? (
              <FormDialog title="Post availability" description="Tell your dispatcher when and where a driver is ready for the next load." triggerLabel="Post availability" triggerSize="sm">
                <AvailabilityForm carrierId={carrierId} drivers={activeDrivers} trucks={truckOptions} zoneLabel={zoneAbbreviation(timezone)} />
              </FormDialog>
            ) : null}
          </CardHeader>
          <AvailabilityList rows={availability.data ?? []} editable timezone={timezone} />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Trucks</CardTitle>
            {owner ? (
              <FormDialog title="Add truck" triggerLabel="Add truck" triggerVariant="secondary" triggerSize="sm">
                <TruckForm carrierId={carrierId} />
              </FormDialog>
            ) : null}
          </CardHeader>
          <TrucksTable trucks={trucks.data ?? []} carrierId={carrierId} editable={owner} />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Drivers</CardTitle>
            {owner ? (
              <FormDialog title="Add driver" triggerLabel="Add driver" triggerVariant="secondary" triggerSize="sm">
                <DriverForm carrierId={carrierId} />
              </FormDialog>
            ) : null}
          </CardHeader>
          <DriversTable drivers={drivers.data ?? []} carrierId={carrierId} editable={owner} today={today} />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Trailers</CardTitle>
            {owner ? (
              <FormDialog title="Add trailer" triggerLabel="Add trailer" triggerVariant="secondary" triggerSize="sm">
                <TrailerForm carrierId={carrierId} trucks={truckOptions} />
              </FormDialog>
            ) : null}
          </CardHeader>
          <TrailersTable trailers={trailers.data ?? []} trucks={truckOptions} carrierId={carrierId} editable={owner} />
        </Card>
      </div>
    </>
  );
}

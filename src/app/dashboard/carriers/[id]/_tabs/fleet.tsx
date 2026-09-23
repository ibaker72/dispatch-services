import type { CarrierTabProps } from "./types";
import { AvailabilityForm, DriverForm, LaneForm, TrailerForm, TruckForm } from "@/components/fleet/fleet-forms";
import { AvailabilityList, DriversTable, LaneList, TrailersTable, TrucksTable } from "@/components/fleet/fleet-tables";
import { FormDialog } from "@/components/action-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { localDate, zoneAbbreviation } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export async function FleetTab({ ctx, carrier }: CarrierTabProps) {
  const { timezone } = await getOperationsSettings();
  const today = localDate(new Date(), timezone);
  const [trucks, trailers, drivers, availability, lanes] = await Promise.all([
    ctx.supabase.from("trucks").select("*").eq("carrier_id", carrier.id).order("unit_number"),
    ctx.supabase.from("trailers").select("*").eq("carrier_id", carrier.id).order("created_at"),
    ctx.supabase.from("drivers").select("*").eq("carrier_id", carrier.id).order("full_name"),
    ctx.supabase
      .from("driver_availability")
      .select("*, drivers(full_name), trucks(unit_number)")
      .eq("carrier_id", carrier.id)
      .or(`available_until.is.null,available_until.gt.${new Date().toISOString()}`)
      .order("available_from"),
    ctx.supabase.from("lane_preferences").select("*").eq("carrier_id", carrier.id).order("preference").order("destination_state"),
  ]);
  const truckOptions = (trucks.data ?? []).map((t) => ({ id: t.id, unit_number: t.unit_number }));
  const activeDrivers = (drivers.data ?? []).filter((d) => d.status === "active");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Trucks</CardTitle>
          <FormDialog title="Add truck" triggerLabel="Add truck" triggerVariant="secondary" triggerSize="sm">
            <TruckForm carrierId={carrier.id} />
          </FormDialog>
        </CardHeader>
        <TrucksTable trucks={trucks.data ?? []} carrierId={carrier.id} editable />
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Drivers</CardTitle>
          <FormDialog title="Add driver" triggerLabel="Add driver" triggerVariant="secondary" triggerSize="sm">
            <DriverForm carrierId={carrier.id} />
          </FormDialog>
        </CardHeader>
        <DriversTable drivers={drivers.data ?? []} carrierId={carrier.id} editable today={today} />
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          {activeDrivers.length ? (
            <FormDialog title="Post availability" triggerLabel="Post availability" triggerVariant="secondary" triggerSize="sm">
              <AvailabilityForm carrierId={carrier.id} drivers={activeDrivers} trucks={truckOptions} zoneLabel={zoneAbbreviation(timezone)} />
            </FormDialog>
          ) : null}
        </CardHeader>
        <AvailabilityList rows={availability.data ?? []} editable timezone={timezone} />
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trailers</CardTitle>
            <FormDialog title="Add trailer" triggerLabel="Add trailer" triggerVariant="secondary" triggerSize="sm">
              <TrailerForm carrierId={carrier.id} trucks={truckOptions} />
            </FormDialog>
          </CardHeader>
          <TrailersTable trailers={trailers.data ?? []} trucks={truckOptions} carrierId={carrier.id} editable />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lanes and minimum rates</CardTitle>
            <FormDialog title="Add lane preference" triggerLabel="Add lane" triggerVariant="secondary" triggerSize="sm">
              <LaneForm carrierId={carrier.id} />
            </FormDialog>
          </CardHeader>
          <LaneList lanes={lanes.data ?? []} editable />
        </Card>
      </div>
    </div>
  );
}

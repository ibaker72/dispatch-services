import { assignLoadEquipment, saveStop, saveVehicle, updateLoadDetails } from "../../actions";
import { ActionForm, FormField } from "@/components/action-form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { EQUIPMENT_KEYS, EQUIPMENT_LABELS } from "@/config/business";
import type { Tables } from "@/lib/db/database.types";
import { isoToZonedLocal, zoneAbbreviation } from "@/lib/domain/dates";
import { US_STATES } from "@/lib/utils";
import { LOAD_VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@/lib/validation/load";

const grid = "grid gap-4 sm:grid-cols-2";


export function LoadDetailsForm({ load, brokers }: { load: Tables<"loads">; brokers: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={updateLoadDetails} submitLabel="Save load details">
      <input type="hidden" name="load_id" value={load.id} />
      <p className="text-sm text-steel-600">Changing the rate after the carrier approved sends the load back to the carrier for a new approval.</p>
      <div className={grid}>
        <FormField id="d-broker_id" name="broker_id" label="Saved broker">
          <Select name="broker_id" defaultValue={load.broker_id ?? ""}>
            <option value="">Not linked</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="d-broker_name" name="broker_name" label="Broker name" required>
          <Input name="broker_name" defaultValue={load.broker_name} maxLength={200} />
        </FormField>
        <FormField id="d-broker_mc" name="broker_mc_number" label="Broker MC">
          <Input name="broker_mc_number" defaultValue={load.broker_mc_number ?? ""} maxLength={20} />
        </FormField>
        <FormField id="d-broker_load" name="broker_load_number" label="Broker load #">
          <Input name="broker_load_number" defaultValue={load.broker_load_number ?? ""} maxLength={60} />
        </FormField>
        <FormField id="d-bcn" name="broker_contact_name" label="Broker contact">
          <Input name="broker_contact_name" defaultValue={load.broker_contact_name ?? ""} maxLength={200} />
        </FormField>
        <FormField id="d-bcp" name="broker_contact_phone" label="Broker phone">
          <Input name="broker_contact_phone" type="tel" defaultValue={load.broker_contact_phone ?? ""} maxLength={40} />
        </FormField>
        <FormField id="d-bce" name="broker_contact_email" label="Broker email">
          <Input name="broker_contact_email" type="email" defaultValue={load.broker_contact_email ?? ""} maxLength={254} />
        </FormField>
        <FormField id="d-equip" name="equipment_type" label="Equipment">
          <Select name="equipment_type" defaultValue={load.equipment_type ?? ""}>
            <option value="">—</option>
            {EQUIPMENT_KEYS.map((k) => (
              <option key={k} value={k}>
                {EQUIPMENT_LABELS[k]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="d-commodity" name="commodity" label="Commodity">
          <Input name="commodity" defaultValue={load.commodity ?? ""} maxLength={200} />
        </FormField>
        <FormField id="d-weight" name="weight_lbs" label="Weight (lb)">
          <Input name="weight_lbs" inputMode="numeric" defaultValue={load.weight_lbs ?? ""} />
        </FormField>
        <FormField id="d-rate" name="gross_rate" label="Gross rate ($)">
          <Input name="gross_rate" inputMode="decimal" defaultValue={load.gross_rate !== null ? Number(load.gross_rate).toFixed(2) : ""} />
        </FormField>
        <FormField id="d-miles" name="loaded_miles" label="Loaded miles">
          <Input name="loaded_miles" inputMode="decimal" defaultValue={load.loaded_miles ?? ""} />
        </FormField>
        <FormField id="d-dh" name="deadhead_miles" label="Deadhead miles">
          <Input name="deadhead_miles" inputMode="decimal" defaultValue={load.deadhead_miles ?? ""} />
        </FormField>
      </div>
    </ActionForm>
  );
}

export function AssignmentForm({
  load,
  trucks,
  trailers,
  drivers,
  dispatchers,
}: {
  load: Tables<"loads">;
  trucks: Array<{ id: string; unit_number: string; status: string }>;
  trailers: Array<{ id: string; trailer_type: string; status: string }>;
  drivers: Array<{ id: string; full_name: string; status: string }>;
  dispatchers: Array<{ user_id: string; label: string }>;
}) {
  return (
    <ActionForm action={assignLoadEquipment} submitLabel="Save assignment">
      <input type="hidden" name="load_id" value={load.id} />
      <FormField id="a-truck" name="truck_id" label="Truck" hint="Only this carrier's own equipment can be assigned.">
        <Select name="truck_id" defaultValue={load.truck_id ?? ""}>
          <option value="">Not assigned</option>
          {trucks.map((t) => (
            <option key={t.id} value={t.id} disabled={t.status !== "active"}>
              {t.unit_number}
              {t.status !== "active" ? ` (${t.status.replace(/_/g, " ")})` : ""}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="a-driver" name="driver_id" label="Driver">
        <Select name="driver_id" defaultValue={load.driver_id ?? ""}>
          <option value="">Not assigned</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id} disabled={d.status !== "active"}>
              {d.full_name}
              {d.status !== "active" ? " (inactive)" : ""}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="a-trailer" name="trailer_id" label="Trailer">
        <Select name="trailer_id" defaultValue={load.trailer_id ?? ""}>
          <option value="">Not assigned</option>
          {trailers.map((t) => (
            <option key={t.id} value={t.id} disabled={t.status !== "active"}>
              {t.trailer_type.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </FormField>
      {dispatchers.length ? (
        <FormField id="a-dispatcher" name="dispatcher_id" label="Dispatcher">
          <Select name="dispatcher_id" defaultValue={load.dispatcher_id ?? ""}>
            {dispatchers.map((d) => (
              <option key={d.user_id} value={d.user_id}>
                {d.label}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
    </ActionForm>
  );
}

export function StopForm({ loadId, stop, timezone }: { loadId: string; stop?: Tables<"load_stops">; timezone: string }) {
  const p = (s: string) => `stop-${stop?.id ?? "new"}-${s}`;
  return (
    <ActionForm action={saveStop} submitLabel={stop ? "Save stop" : "Add stop"} resetOnSuccess={!stop}>
      <input type="hidden" name="load_id" value={loadId} />
      {stop ? <input type="hidden" name="stop_id" value={stop.id} /> : null}
      <div className={grid}>
        <FormField id={p("type")} name="stop_type" label="Type" required>
          <Select name="stop_type" defaultValue={stop?.stop_type ?? "delivery"}>
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </Select>
        </FormField>
        <FormField id={p("facility")} name="facility_name" label="Facility">
          <Input name="facility_name" defaultValue={stop?.facility_name ?? ""} maxLength={200} />
        </FormField>
        <FormField id={p("address")} name="address_line1" label="Street address">
          <Input name="address_line1" defaultValue={stop?.address_line1 ?? ""} maxLength={200} />
        </FormField>
        <FormField id={p("city")} name="city" label="City" required>
          <Input name="city" defaultValue={stop?.city ?? ""} maxLength={100} />
        </FormField>
        <FormField id={p("state")} name="state" label="State" required>
          <Select name="state" defaultValue={stop?.state ?? ""}>
            <option value="">Choose</option>
            {US_STATES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={p("zip")} name="postal_code" label="ZIP">
          <Input name="postal_code" defaultValue={stop?.postal_code ?? ""} maxLength={10} />
        </FormField>
        <FormField id={p("appt")} name="appointment_type" label="Timing">
          <Select name="appointment_type" defaultValue={stop?.appointment_type ?? "window"}>
            <option value="window">Time window</option>
            <option value="appointment">Appointment</option>
            <option value="fcfs">First come, first served</option>
          </Select>
        </FormField>
        <div />
        <FormField id={p("start")} name="window_start" label={`From (${zoneAbbreviation(timezone)})`}>
          <Input name="window_start" type="datetime-local" defaultValue={isoToZonedLocal(stop?.window_start, timezone)} />
        </FormField>
        <FormField id={p("end")} name="window_end" label={`Until (${zoneAbbreviation(timezone)})`}>
          <Input name="window_end" type="datetime-local" defaultValue={isoToZonedLocal(stop?.window_end, timezone)} />
        </FormField>
        <FormField id={p("contact")} name="contact_name" label="Contact">
          <Input name="contact_name" defaultValue={stop?.contact_name ?? ""} maxLength={200} />
        </FormField>
        <FormField id={p("phone")} name="contact_phone" label="Contact phone">
          <Input name="contact_phone" type="tel" defaultValue={stop?.contact_phone ?? ""} maxLength={40} />
        </FormField>
      </div>
      <FormField id={p("instructions")} name="instructions" label="Instructions">
        <Textarea name="instructions" rows={2} defaultValue={stop?.instructions ?? ""} maxLength={2000} />
      </FormField>
    </ActionForm>
  );
}

export function VehicleForm({ loadId, vehicle, stops }: { loadId: string; vehicle?: Tables<"load_vehicles">; stops: Array<Tables<"load_stops">> }) {
  const p = (s: string) => `veh-${vehicle?.id ?? "new"}-${s}`;
  const stopLabel = (s: Tables<"load_stops">) => `Stop ${s.sequence}: ${s.city}, ${s.state}`;
  return (
    <ActionForm action={saveVehicle} submitLabel={vehicle ? "Save vehicle" : "Add vehicle"} resetOnSuccess={!vehicle}>
      <input type="hidden" name="load_id" value={loadId} />
      {vehicle ? <input type="hidden" name="vehicle_id" value={vehicle.id} /> : null}
      <div className={grid}>
        <FormField id={p("vin")} name="vin" label="VIN">
          <Input name="vin" defaultValue={vehicle?.vin ?? ""} maxLength={17} />
        </FormField>
        <FormField id={p("year")} name="year" label="Year">
          <Input name="year" inputMode="numeric" defaultValue={vehicle?.year ?? ""} />
        </FormField>
        <FormField id={p("make")} name="make" label="Make">
          <Input name="make" defaultValue={vehicle?.make ?? ""} maxLength={60} />
        </FormField>
        <FormField id={p("model")} name="model" label="Model">
          <Input name="model" defaultValue={vehicle?.model ?? ""} maxLength={60} />
        </FormField>
        <FormField id={p("type")} name="vehicle_type" label="Type">
          <Select name="vehicle_type" defaultValue={vehicle?.vehicle_type ?? "sedan"}>
            {LOAD_VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {VEHICLE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={p("lot")} name="lot_number" label="Lot / stock #">
          <Input name="lot_number" defaultValue={vehicle?.lot_number ?? ""} maxLength={60} />
        </FormField>
        <FormField id={p("dealer")} name="auction_or_dealer_name" label="Auction or dealer">
          <Input name="auction_or_dealer_name" defaultValue={vehicle?.auction_or_dealer_name ?? ""} maxLength={200} />
        </FormField>
        <FormField id={p("pickup")} name="pickup_stop_id" label="Pickup stop">
          <Select name="pickup_stop_id" defaultValue={vehicle?.pickup_stop_id ?? ""}>
            <option value="">—</option>
            {stops
              .filter((s) => s.stop_type === "pickup")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {stopLabel(s)}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField id={p("delivery")} name="delivery_stop_id" label="Delivery stop">
          <Select name="delivery_stop_id" defaultValue={vehicle?.delivery_stop_id ?? ""}>
            <option value="">—</option>
            {stops
              .filter((s) => s.stop_type === "delivery")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {stopLabel(s)}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField id={p("pcn")} name="pickup_contact_name" label="Pickup contact">
          <Input name="pickup_contact_name" defaultValue={vehicle?.pickup_contact_name ?? ""} maxLength={200} />
        </FormField>
        <FormField id={p("pcp")} name="pickup_contact_phone" label="Pickup contact phone">
          <Input name="pickup_contact_phone" type="tel" defaultValue={vehicle?.pickup_contact_phone ?? ""} maxLength={40} />
        </FormField>
        <FormField id={p("dcn")} name="delivery_contact_name" label="Delivery contact">
          <Input name="delivery_contact_name" defaultValue={vehicle?.delivery_contact_name ?? ""} maxLength={200} />
        </FormField>
        <FormField id={p("dcp")} name="delivery_contact_phone" label="Delivery contact phone">
          <Input name="delivery_contact_phone" type="tel" defaultValue={vehicle?.delivery_contact_phone ?? ""} maxLength={40} />
        </FormField>
        <FormField id={p("insp")} name="inspection_status" label="Inspection">
          <Select name="inspection_status" defaultValue={vehicle?.inspection_status ?? "pending"}>
            <option value="pending">Pending</option>
            <option value="pickup_inspected">Inspected at pickup</option>
            <option value="delivery_inspected">Inspected at delivery</option>
            <option value="damage_noted">Damage noted</option>
          </Select>
        </FormField>
        <FormField id={p("docs")} name="document_status" label="Paperwork">
          <Select name="document_status" defaultValue={vehicle?.document_status ?? "pending"}>
            <option value="pending">Pending</option>
            <option value="received">Received</option>
            <option value="verified">Verified</option>
          </Select>
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="operable" defaultChecked={vehicle?.operable ?? true} />
        <span>Runs and drives (operable)</span>
      </label>
      <FormField id={p("keys")} name="keys_title_notes" label="Keys / title notes">
        <Input name="keys_title_notes" defaultValue={vehicle?.keys_title_notes ?? ""} maxLength={1000} />
      </FormField>
    </ActionForm>
  );
}

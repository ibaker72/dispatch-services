import { addAvailability, addLanePreference, saveDriver, saveTrailer, saveTruck } from "@/app/actions/fleet";
import { ActionForm, FormField } from "@/components/action-form";
import { TimezoneOffsetInput } from "@/components/timezone-offset-input";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { EQUIPMENT_KEYS, EQUIPMENT_LABELS } from "@/config/business";
import type { Tables } from "@/lib/db/database.types";
import { TRAILER_TYPE_LABELS } from "@/lib/domain/labels";
import { US_STATES } from "@/lib/utils";
import { TRAILER_TYPES } from "@/lib/validation/application";

function StateSelect({ name, defaultValue, placeholder = "—" }: { name: string; defaultValue?: string | null; placeholder?: string }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? ""}>
      <option value="">{placeholder}</option>
      {US_STATES.map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </Select>
  );
}

const grid = "grid gap-4 sm:grid-cols-2";

export function TruckForm({ carrierId, truck, idPrefix = "truck" }: { carrierId: string; truck?: Tables<"trucks">; idPrefix?: string }) {
  const p = (s: string) => `${idPrefix}-${s}`;
  return (
    <ActionForm action={saveTruck} submitLabel={truck ? "Save truck" : "Add truck"} resetOnSuccess={!truck}>
      <input type="hidden" name="carrier_id" value={carrierId} />
      {truck ? <input type="hidden" name="id" value={truck.id} /> : null}
      <div className={grid}>
        <FormField id={p("unit")} name="unit_number" label="Unit number" required>
          <Input name="unit_number" defaultValue={truck?.unit_number} maxLength={40} />
        </FormField>
        <FormField id={p("equipment")} name="equipment_type" label="Equipment" required>
          <Select name="equipment_type" defaultValue={truck?.equipment_type ?? "car_hauler"}>
            {EQUIPMENT_KEYS.map((k) => (
              <option key={k} value={k}>
                {EQUIPMENT_LABELS[k]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={p("year")} name="year" label="Year">
          <Input name="year" inputMode="numeric" defaultValue={truck?.year ?? ""} />
        </FormField>
        <FormField id={p("make")} name="make" label="Make">
          <Input name="make" defaultValue={truck?.make ?? ""} maxLength={60} />
        </FormField>
        <FormField id={p("model")} name="model" label="Model">
          <Input name="model" defaultValue={truck?.model ?? ""} maxLength={60} />
        </FormField>
        <FormField id={p("vin")} name="vin" label="VIN">
          <Input name="vin" defaultValue={truck?.vin ?? ""} maxLength={17} autoCapitalize="characters" />
        </FormField>
        <FormField id={p("plate")} name="license_plate" label="License plate">
          <Input name="license_plate" defaultValue={truck?.license_plate ?? ""} maxLength={20} />
        </FormField>
        <FormField id={p("plate-state")} name="plate_state" label="Plate state">
          <StateSelect name="plate_state" defaultValue={truck?.plate_state} />
        </FormField>
        <FormField id={p("capacity")} name="vehicle_capacity" label="Vehicle capacity" hint="Car haulers: number of vehicles.">
          <Input name="vehicle_capacity" inputMode="numeric" defaultValue={truck?.vehicle_capacity ?? ""} />
        </FormField>
        <FormField id={p("payload")} name="max_payload_lbs" label="Max payload (lb)">
          <Input name="max_payload_lbs" inputMode="numeric" defaultValue={truck?.max_payload_lbs ?? ""} />
        </FormField>
        <FormField id={p("status")} name="status" label="Status">
          <Select name="status" defaultValue={truck?.status ?? "active"}>
            <option value="active">Active</option>
            <option value="out_of_service">Out of service</option>
            <option value="inactive">Inactive</option>
          </Select>
        </FormField>
      </div>
      <FormField id={p("notes")} name="notes" label="Notes">
        <Textarea name="notes" rows={2} defaultValue={truck?.notes ?? ""} maxLength={1000} />
      </FormField>
    </ActionForm>
  );
}

export function TrailerForm({
  carrierId,
  trailer,
  trucks,
  idPrefix = "trailer",
}: {
  carrierId: string;
  trailer?: Tables<"trailers">;
  trucks: Array<Pick<Tables<"trucks">, "id" | "unit_number">>;
  idPrefix?: string;
}) {
  const p = (s: string) => `${idPrefix}-${s}`;
  return (
    <ActionForm action={saveTrailer} submitLabel={trailer ? "Save trailer" : "Add trailer"} resetOnSuccess={!trailer}>
      <input type="hidden" name="carrier_id" value={carrierId} />
      {trailer ? <input type="hidden" name="id" value={trailer.id} /> : null}
      <div className={grid}>
        <FormField id={p("type")} name="trailer_type" label="Trailer type" required>
          <Select name="trailer_type" defaultValue={trailer?.trailer_type ?? "open_car_hauler"}>
            {TRAILER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRAILER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={p("truck")} name="truck_id" label="Usually pulled by">
          <Select name="truck_id" defaultValue={trailer?.truck_id ?? ""}>
            <option value="">Not assigned</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.unit_number}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={p("length")} name="length_ft" label="Length (ft)">
          <Input name="length_ft" inputMode="decimal" defaultValue={trailer?.length_ft ?? ""} />
        </FormField>
        <FormField id={p("capacity")} name="vehicle_capacity" label="Vehicle capacity">
          <Input name="vehicle_capacity" inputMode="numeric" defaultValue={trailer?.vehicle_capacity ?? ""} />
        </FormField>
        <FormField id={p("payload")} name="max_payload_lbs" label="Max payload (lb)">
          <Input name="max_payload_lbs" inputMode="numeric" defaultValue={trailer?.max_payload_lbs ?? ""} />
        </FormField>
        <FormField id={p("plate")} name="license_plate" label="License plate">
          <Input name="license_plate" defaultValue={trailer?.license_plate ?? ""} maxLength={20} />
        </FormField>
        <FormField id={p("vin")} name="vin" label="VIN">
          <Input name="vin" defaultValue={trailer?.vin ?? ""} maxLength={17} />
        </FormField>
        <FormField id={p("status")} name="status" label="Status">
          <Select name="status" defaultValue={trailer?.status ?? "active"}>
            <option value="active">Active</option>
            <option value="out_of_service">Out of service</option>
            <option value="inactive">Inactive</option>
          </Select>
        </FormField>
      </div>
    </ActionForm>
  );
}

export function DriverForm({ carrierId, driver, idPrefix = "driver" }: { carrierId: string; driver?: Tables<"drivers">; idPrefix?: string }) {
  const p = (s: string) => `${idPrefix}-${s}`;
  return (
    <ActionForm action={saveDriver} submitLabel={driver ? "Save driver" : "Add driver"} resetOnSuccess={!driver}>
      <input type="hidden" name="carrier_id" value={carrierId} />
      {driver ? <input type="hidden" name="id" value={driver.id} /> : null}
      <div className={grid}>
        <FormField id={p("name")} name="full_name" label="Full name" required>
          <Input name="full_name" defaultValue={driver?.full_name} maxLength={120} autoComplete="off" />
        </FormField>
        <FormField id={p("phone")} name="phone" label="Phone">
          <Input name="phone" type="tel" defaultValue={driver?.phone ?? ""} maxLength={40} autoComplete="off" />
        </FormField>
        <FormField id={p("email")} name="email" label="Email">
          <Input name="email" type="email" defaultValue={driver?.email ?? ""} maxLength={254} autoComplete="off" />
        </FormField>
        <FormField id={p("license-state")} name="license_state" label="CDL / license state">
          <StateSelect name="license_state" defaultValue={driver?.license_state} />
        </FormField>
        <FormField id={p("license-exp")} name="license_expiration" label="License expires">
          <Input name="license_expiration" type="date" defaultValue={driver?.license_expiration ?? ""} />
        </FormField>
        <FormField id={p("medical-exp")} name="medical_card_expiration" label="Medical card expires">
          <Input name="medical_card_expiration" type="date" defaultValue={driver?.medical_card_expiration ?? ""} />
        </FormField>
        <FormField id={p("status")} name="status" label="Status">
          <Select name="status" defaultValue={driver?.status ?? "active"}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </FormField>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="is_owner_operator" defaultChecked={driver?.is_owner_operator ?? false} />
        <span>Owner-operator</span>
      </label>
    </ActionForm>
  );
}

export function AvailabilityForm({
  carrierId,
  drivers,
  trucks,
  idPrefix = "availability",
}: {
  carrierId: string;
  drivers: Array<Pick<Tables<"drivers">, "id" | "full_name">>;
  trucks: Array<Pick<Tables<"trucks">, "id" | "unit_number">>;
  idPrefix?: string;
}) {
  const p = (s: string) => `${idPrefix}-${s}`;
  return (
    <ActionForm action={addAvailability} submitLabel="Post availability" resetOnSuccess>
      <input type="hidden" name="carrier_id" value={carrierId} />
      <TimezoneOffsetInput />
      <div className={grid}>
        <FormField id={p("driver")} name="driver_id" label="Driver" required>
          <Select name="driver_id" defaultValue="">
            <option value="" disabled>
              Choose a driver
            </option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={p("truck")} name="truck_id" label="Truck">
          <Select name="truck_id" defaultValue="">
            <option value="">Not specified</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.unit_number}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={p("status")} name="status" label="Status" required>
          <Select name="status" defaultValue="available">
            <option value="available">Available for loads</option>
            <option value="home_time">Home time</option>
            <option value="unavailable">Unavailable</option>
          </Select>
        </FormField>
        <div />
        <FormField id={p("from")} name="available_from" label="From" required>
          <Input name="available_from" type="datetime-local" />
        </FormField>
        <FormField id={p("until")} name="available_until" label="Until">
          <Input name="available_until" type="datetime-local" />
        </FormField>
        <FormField id={p("city")} name="location_city" label="Location city">
          <Input name="location_city" maxLength={100} />
        </FormField>
        <FormField id={p("state")} name="location_state" label="Location state">
          <StateSelect name="location_state" />
        </FormField>
      </div>
      <FormField id={p("notes")} name="notes" label="Notes">
        <Textarea name="notes" rows={2} maxLength={1000} />
      </FormField>
    </ActionForm>
  );
}

export function LaneForm({ carrierId, idPrefix = "lane" }: { carrierId: string; idPrefix?: string }) {
  const p = (s: string) => `${idPrefix}-${s}`;
  return (
    <ActionForm action={addLanePreference} submitLabel="Add lane" resetOnSuccess>
      <input type="hidden" name="carrier_id" value={carrierId} />
      <div className={grid}>
        <FormField id={p("pref")} name="preference" label="Preference" required>
          <Select name="preference" defaultValue="preferred">
            <option value="preferred">Preferred</option>
            <option value="avoid">Avoid</option>
          </Select>
        </FormField>
        <FormField id={p("rate")} name="min_rate_per_mile" label="Minimum rate per mile" hint="Optional, in dollars.">
          <Input name="min_rate_per_mile" inputMode="decimal" />
        </FormField>
        <FormField id={p("origin")} name="origin_state" label="Origin state">
          <StateSelect name="origin_state" placeholder="Any origin" />
        </FormField>
        <FormField id={p("dest")} name="destination_state" label="Destination state">
          <StateSelect name="destination_state" placeholder="Any destination" />
        </FormField>
      </div>
      <FormField id={p("notes")} name="notes" label="Notes">
        <Input name="notes" maxLength={500} />
      </FormField>
    </ActionForm>
  );
}

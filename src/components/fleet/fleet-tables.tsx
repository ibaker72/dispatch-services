import { DriverForm, TrailerForm, TruckForm } from "./fleet-forms";
import { removeAvailability, removeLanePreference } from "@/app/actions/fleet";
import { ActionForm, FormDialog } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EQUIPMENT_LABELS, type EquipmentKey } from "@/config/business";
import type { Tables } from "@/lib/db/database.types";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { TRAILER_TYPE_LABELS } from "@/lib/domain/labels";

export function TrucksTable({ trucks, carrierId, editable }: { trucks: Array<Tables<"trucks">>; carrierId: string; editable: boolean }) {
  if (!trucks.length) return <p className="px-5 py-4 text-sm text-steel-600">No trucks yet.</p>;
  return (
    <Table caption="Trucks">
      <THead>
        <tr>
          <TH>Unit</TH>
          <TH>Equipment</TH>
          <TH>Vehicle</TH>
          <TH>Capacity</TH>
          <TH>Status</TH>
          {editable ? (
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          ) : null}
        </tr>
      </THead>
      <tbody>
        {trucks.map((t) => (
          <TR key={t.id}>
            <TD className="font-semibold">{t.unit_number}</TD>
            <TD>{EQUIPMENT_LABELS[t.equipment_type as EquipmentKey] ?? t.equipment_type}</TD>
            <TD>
              {[t.year, t.make, t.model].filter(Boolean).join(" ") || "—"}
              {t.vin ? <div className="font-mono text-xs text-steel-600">VIN {t.vin}</div> : null}
            </TD>
            <TD>
              {t.vehicle_capacity ? `${t.vehicle_capacity} vehicles` : ""}
              {t.max_payload_lbs ? <div className="text-xs text-steel-600">{Number(t.max_payload_lbs).toLocaleString()} lb</div> : null}
              {!t.vehicle_capacity && !t.max_payload_lbs ? "—" : null}
            </TD>
            <TD>
              <StatusBadge status={t.status} />
            </TD>
            {editable ? (
              <TD className="text-right">
                <FormDialog title={`Edit truck ${t.unit_number}`} triggerLabel="Edit" triggerVariant="secondary" triggerSize="sm">
                  <TruckForm carrierId={carrierId} truck={t} idPrefix={`truck-${t.id}`} />
                </FormDialog>
              </TD>
            ) : null}
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

export function TrailersTable({
  trailers,
  trucks,
  carrierId,
  editable,
}: {
  trailers: Array<Tables<"trailers">>;
  trucks: Array<Pick<Tables<"trucks">, "id" | "unit_number">>;
  carrierId: string;
  editable: boolean;
}) {
  if (!trailers.length) return <p className="px-5 py-4 text-sm text-steel-600">No trailers listed.</p>;
  const unit = new Map(trucks.map((t) => [t.id, t.unit_number]));
  return (
    <Table caption="Trailers">
      <THead>
        <tr>
          <TH>Type</TH>
          <TH>Pulled by</TH>
          <TH>Size</TH>
          <TH>Status</TH>
          {editable ? (
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          ) : null}
        </tr>
      </THead>
      <tbody>
        {trailers.map((t) => (
          <TR key={t.id}>
            <TD>{TRAILER_TYPE_LABELS[t.trailer_type] ?? t.trailer_type}</TD>
            <TD>{t.truck_id ? unit.get(t.truck_id) : "—"}</TD>
            <TD>{[t.length_ft ? `${t.length_ft} ft` : null, t.vehicle_capacity ? `${t.vehicle_capacity} vehicles` : null].filter(Boolean).join(" · ") || "—"}</TD>
            <TD>
              <StatusBadge status={t.status} />
            </TD>
            {editable ? (
              <TD className="text-right">
                <FormDialog title="Edit trailer" triggerLabel="Edit" triggerVariant="secondary" triggerSize="sm">
                  <TrailerForm carrierId={carrierId} trailer={t} trucks={trucks} idPrefix={`trailer-${t.id}`} />
                </FormDialog>
              </TD>
            ) : null}
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

export function DriversTable({ drivers, carrierId, editable, today }: { drivers: Array<Tables<"drivers">>; carrierId: string; editable: boolean; today: string }) {
  if (!drivers.length) return <p className="px-5 py-4 text-sm text-steel-600">No drivers yet.</p>;
  const exp = (d: string | null) =>
    d ? <span className={d < today ? "font-semibold text-danger" : undefined}>{formatDate(d)}</span> : "—";
  return (
    <Table caption="Drivers">
      <THead>
        <tr>
          <TH>Driver</TH>
          <TH>Contact</TH>
          <TH>License expires</TH>
          <TH>Medical card</TH>
          <TH>Status</TH>
          {editable ? (
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          ) : null}
        </tr>
      </THead>
      <tbody>
        {drivers.map((d) => (
          <TR key={d.id}>
            <TD>
              <span className="font-semibold">{d.full_name}</span>
              {d.is_owner_operator ? <div className="text-xs text-steel-600">Owner-operator</div> : null}
            </TD>
            <TD>
              {d.phone ?? "—"}
              {d.email ? <div className="text-xs text-steel-600">{d.email}</div> : null}
            </TD>
            <TD>{exp(d.license_expiration)}</TD>
            <TD>{exp(d.medical_card_expiration)}</TD>
            <TD>
              <StatusBadge status={d.status} />
            </TD>
            {editable ? (
              <TD className="text-right">
                <FormDialog title={`Edit ${d.full_name}`} triggerLabel="Edit" triggerVariant="secondary" triggerSize="sm">
                  <DriverForm carrierId={carrierId} driver={d} idPrefix={`driver-${d.id}`} />
                </FormDialog>
              </TD>
            ) : null}
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

type AvailabilityRow = Tables<"driver_availability"> & { drivers: { full_name: string } | null; trucks: { unit_number: string } | null };

export function AvailabilityList({ rows, editable, timezone }: { rows: AvailabilityRow[]; editable: boolean; timezone: string }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-steel-600">No availability posted.</p>;
  return (
    <ul className="divide-y divide-steel-100">
      {rows.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
          <div>
            <div className="font-semibold">
              {a.drivers?.full_name ?? "Driver"}
              {a.trucks ? ` · ${a.trucks.unit_number}` : ""} <StatusBadge status={a.status} />
            </div>
            <div className="text-steel-700">
              {formatDateTime(a.available_from, timezone)}
              {a.available_until ? ` – ${formatDateTime(a.available_until, timezone)}` : " onward"}
              {a.location_city || a.location_state ? ` · ${[a.location_city, a.location_state].filter(Boolean).join(", ")}` : ""}
            </div>
            {a.notes ? <div className="text-xs text-steel-600">{a.notes}</div> : null}
          </div>
          {editable ? (
            <ActionForm action={removeAvailability} submitLabel="Remove" submitVariant="ghost" submitSize="sm" inline>
              <input type="hidden" name="id" value={a.id} />
            </ActionForm>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function LaneList({ lanes, editable }: { lanes: Array<Tables<"lane_preferences">>; editable: boolean }) {
  if (!lanes.length) return <p className="px-5 py-4 text-sm text-steel-600">No lane preferences recorded.</p>;
  return (
    <ul className="divide-y divide-steel-100">
      {lanes.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm">
          <span>
            <Badge tone={l.preference === "avoid" ? "danger" : "success"}>{l.preference === "avoid" ? "Avoid" : "Preferred"}</Badge>{" "}
            <span className="font-medium">
              {l.origin_state ?? "Any"} → {l.destination_state ?? "Any"}
            </span>
            {l.min_rate_per_mile ? <span className="text-steel-600"> · min ${Number(l.min_rate_per_mile).toFixed(2)}/mi</span> : null}
            {l.notes ? <span className="text-steel-600"> · {l.notes}</span> : null}
          </span>
          {editable ? (
            <ActionForm action={removeLanePreference} submitLabel="Remove" submitVariant="ghost" submitSize="sm" inline>
              <input type="hidden" name="id" value={l.id} />
            </ActionForm>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

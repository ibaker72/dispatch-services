"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { type Path, useFieldArray, useForm, useWatch } from "react-hook-form";
import { createLoad } from "../actions";
import { errorAt } from "@/components/application/step-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { EQUIPMENT_KEYS, EQUIPMENT_LABELS } from "@/config/business";
import { US_STATES } from "@/lib/utils";
import { LOAD_VEHICLE_TYPES, type LoadCreateInput, VEHICLE_TYPE_LABELS } from "@/lib/validation/load";

interface Values {
  carrier_id: string;
  broker_id: string;
  broker_name: string;
  broker_mc_number: string;
  broker_contact_name: string;
  broker_contact_phone: string;
  broker_contact_email: string;
  broker_load_number: string;
  save_broker: boolean;
  equipment_type: string;
  commodity: string;
  weight_lbs: string;
  gross_rate: string;
  loaded_miles: string;
  deadhead_miles: string;
  internal_note: string;
  stops: Array<Record<string, string>>;
  vehicles: Array<Record<string, string | boolean>>;
}

const emptyStop = (stop_type: "pickup" | "delivery") => ({
  stop_type,
  facility_name: "",
  address_line1: "",
  city: "",
  state: "",
  postal_code: "",
  appointment_type: "window",
  window_start: "",
  window_end: "",
  contact_name: "",
  contact_phone: "",
  instructions: "",
});
const emptyVehicle = { vin: "", year: "", make: "", model: "", vehicle_type: "sedan", operable: true, lot_number: "", auction_or_dealer_name: "", pickup_sequence: "", delivery_sequence: "", keys_title_notes: "" };

export interface CarrierOption {
  id: string;
  legal_name: string;
  primary_equipment: string | null;
}

export function LoadCreateForm({
  carriers,
  brokers,
  defaultCarrierId,
  zoneLabel,
}: {
  zoneLabel: string;
  carriers: CarrierOption[];
  brokers: Array<{ id: string; name: string; mc_number: string | null; phone: string | null; email: string | null; do_not_use: boolean }>;
  defaultCarrierId?: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const defaultCarrier = carriers.find((c) => c.id === defaultCarrierId) ?? (carriers.length === 1 ? carriers[0] : undefined);
  const form = useForm<Values>({
    defaultValues: {
      carrier_id: defaultCarrier?.id ?? "",
      broker_id: "",
      broker_name: "",
      broker_mc_number: "",
      broker_contact_name: "",
      broker_contact_phone: "",
      broker_contact_email: "",
      broker_load_number: "",
      save_broker: true,
      equipment_type: defaultCarrier?.primary_equipment ?? "",
      commodity: "",
      weight_lbs: "",
      gross_rate: "",
      loaded_miles: "",
      deadhead_miles: "",
      internal_note: "",
      stops: [emptyStop("pickup"), emptyStop("delivery")],
      vehicles: [],
    },
  });
  const stops = useFieldArray({ control: form.control, name: "stops" });
  const vehicles = useFieldArray({ control: form.control, name: "vehicles" });
  const { register, formState } = form;
  const brokerId = useWatch({ control: form.control, name: "broker_id" });
  const stopValues = useWatch({ control: form.control, name: "stops" });
  const errors = formState.errors;
  const err = (path: string) => errorAt(errors, path);

  function onBrokerPick(id: string) {
    const b = brokers.find((x) => x.id === id);
    form.setValue("broker_id", id);
    if (b) {
      form.setValue("broker_name", b.name);
      form.setValue("broker_mc_number", b.mc_number ?? "");
      form.setValue("broker_contact_phone", b.phone ?? "");
      form.setValue("broker_contact_email", b.email ?? "");
      form.setValue("save_broker", false);
    }
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) =>
    form.handleSubmit(async (values) => {
      setFormError(null);
      form.clearErrors();
      const input = {
        ...values,
        vehicles: values.vehicles.map((v) => ({ ...v, operable: v.operable === true })),
      } as unknown as LoadCreateInput;
      const result = await createLoad(input);
      if (!result.ok) {
        setFormError(result.error);
        for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(key as Path<Values>, { message: messages[0] });
        }
        return;
      }
      router.push(`/dashboard/loads/${result.data}`);
    })(event);

  const selectedBroker = brokers.find((b) => b.id === brokerId);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError ? (
        <Alert tone="danger" live title={formError}>
          {errors.stops?.root?.message ?? errors.stops?.message ?? null}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Carrier and broker</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field id="carrier_id" label="Carrier" required error={err("carrier_id")} hint="Only active carriers with an accepted agreement and fee terms are listed.">
            <Select {...register("carrier_id")}>
              <option value="">Choose a carrier</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legal_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="broker_pick" label="Saved broker">
            <Select value={brokerId} onChange={(e) => onBrokerPick(e.target.value)}>
              <option value="">New / not saved</option>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.do_not_use ? " (do not use)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          {selectedBroker?.do_not_use ? (
            <Alert tone="warning" className="sm:col-span-2">
              This broker is marked “do not use”. Check the broker notes before proceeding.
            </Alert>
          ) : null}
          <Field id="broker_name" label="Broker name" required error={err("broker_name")}>
            <Input {...register("broker_name")} maxLength={200} />
          </Field>
          <Field id="broker_mc_number" label="Broker MC number" error={err("broker_mc_number")}>
            <Input {...register("broker_mc_number")} maxLength={20} />
          </Field>
          <Field id="broker_contact_name" label="Broker contact" error={err("broker_contact_name")}>
            <Input {...register("broker_contact_name")} maxLength={200} />
          </Field>
          <Field id="broker_contact_phone" label="Broker phone" error={err("broker_contact_phone")}>
            <Input type="tel" {...register("broker_contact_phone")} maxLength={40} />
          </Field>
          <Field id="broker_contact_email" label="Broker email" error={err("broker_contact_email")}>
            <Input type="email" {...register("broker_contact_email")} maxLength={254} />
          </Field>
          <Field id="broker_load_number" label="Broker load / PO number" error={err("broker_load_number")}>
            <Input {...register("broker_load_number")} maxLength={60} />
          </Field>
          {!brokerId ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox {...register("save_broker")} />
              <span>Save this broker for future loads</span>
            </label>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Freight and rate</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field id="equipment_type" label="Equipment" error={err("equipment_type")}>
            <Select {...register("equipment_type")}>
              <option value="">—</option>
              {EQUIPMENT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {EQUIPMENT_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="commodity" label="Commodity" error={err("commodity")}>
            <Input {...register("commodity")} maxLength={200} />
          </Field>
          <Field id="weight_lbs" label="Weight (lb)" error={err("weight_lbs")}>
            <Input inputMode="numeric" {...register("weight_lbs")} />
          </Field>
          <Field id="gross_rate" label="Gross rate ($)" error={err("gross_rate")} hint="Required before sending to the carrier.">
            <Input inputMode="decimal" {...register("gross_rate")} placeholder="1850.00" />
          </Field>
          <Field id="loaded_miles" label="Loaded miles" error={err("loaded_miles")}>
            <Input inputMode="decimal" {...register("loaded_miles")} />
          </Field>
          <Field id="deadhead_miles" label="Deadhead miles" error={err("deadhead_miles")}>
            <Input inputMode="decimal" {...register("deadhead_miles")} placeholder="0" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stops</CardTitle>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => stops.append(emptyStop("pickup"))}>
              <Plus aria-hidden="true" /> Pickup
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => stops.append(emptyStop("delivery"))}>
              <Plus aria-hidden="true" /> Delivery
            </Button>
          </div>
        </CardHeader>
        <CardBody className="space-y-6">
          {err("stops") ? <p className="text-sm font-medium text-danger">{err("stops")}</p> : null}
          {stops.fields.map((field, i) => (
            <fieldset key={field.id} className="rounded-md border border-steel-200 p-4">
              <legend className="px-1 text-sm font-semibold">
                Stop {i + 1}: {stopValues[i]?.stop_type === "pickup" ? "Pickup" : "Delivery"}
              </legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id={`stops-${i}-type`} label="Type">
                  <Select {...register(`stops.${i}.stop_type`)}>
                    <option value="pickup">Pickup</option>
                    <option value="delivery">Delivery</option>
                  </Select>
                </Field>
                <Field id={`stops-${i}-facility`} label="Facility" error={err(`stops.${i}.facility_name`)}>
                  <Input {...register(`stops.${i}.facility_name`)} maxLength={200} />
                </Field>
                <Field id={`stops-${i}-address`} label="Street address" error={err(`stops.${i}.address_line1`)}>
                  <Input {...register(`stops.${i}.address_line1`)} maxLength={200} />
                </Field>
                <Field id={`stops-${i}-city`} label="City" required error={err(`stops.${i}.city`)}>
                  <Input {...register(`stops.${i}.city`)} maxLength={100} />
                </Field>
                <Field id={`stops-${i}-state`} label="State" required error={err(`stops.${i}.state`)}>
                  <Select {...register(`stops.${i}.state`)}>
                    <option value="">Choose</option>
                    {US_STATES.map(([c, n]) => (
                      <option key={c} value={c}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`stops-${i}-zip`} label="ZIP" error={err(`stops.${i}.postal_code`)}>
                  <Input inputMode="numeric" {...register(`stops.${i}.postal_code`)} maxLength={10} />
                </Field>
                <Field id={`stops-${i}-appt`} label="Timing">
                  <Select {...register(`stops.${i}.appointment_type`)}>
                    <option value="window">Time window</option>
                    <option value="appointment">Appointment</option>
                    <option value="fcfs">First come, first served</option>
                  </Select>
                </Field>
                <Field id={`stops-${i}-start`} label={`From (${zoneLabel})`} error={err(`stops.${i}.window_start`)}>
                  <Input type="datetime-local" {...register(`stops.${i}.window_start`)} />
                </Field>
                <Field id={`stops-${i}-end`} label={`Until (${zoneLabel})`} error={err(`stops.${i}.window_end`)}>
                  <Input type="datetime-local" {...register(`stops.${i}.window_end`)} />
                </Field>
                <Field id={`stops-${i}-contact`} label="Contact name">
                  <Input {...register(`stops.${i}.contact_name`)} maxLength={200} />
                </Field>
                <Field id={`stops-${i}-phone`} label="Contact phone">
                  <Input type="tel" {...register(`stops.${i}.contact_phone`)} maxLength={40} />
                </Field>
              </div>
              <Field id={`stops-${i}-instructions`} label="Instructions" className="mt-4">
                <Textarea rows={2} {...register(`stops.${i}.instructions`)} maxLength={2000} />
              </Field>
              {stops.fields.length > 2 ? (
                <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => stops.remove(i)}>
                  <Trash2 aria-hidden="true" /> Remove stop {i + 1}
                </Button>
              ) : null}
            </fieldset>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicles (car hauling)</CardTitle>
          <Button type="button" variant="secondary" size="sm" onClick={() => vehicles.append({ ...emptyVehicle })}>
            <Plus aria-hidden="true" /> Add vehicle
          </Button>
        </CardHeader>
        <CardBody className="space-y-6">
          {vehicles.fields.length === 0 ? <p className="text-sm text-steel-600">Add each vehicle for car-hauler loads. Skip for other freight.</p> : null}
          {vehicles.fields.map((field, i) => (
            <fieldset key={field.id} className="rounded-md border border-steel-200 p-4">
              <legend className="px-1 text-sm font-semibold">Vehicle {i + 1}</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id={`veh-${i}-vin`} label="VIN" error={err(`vehicles.${i}.vin`)}>
                  <Input {...register(`vehicles.${i}.vin`)} maxLength={17} autoCapitalize="characters" />
                </Field>
                <Field id={`veh-${i}-year`} label="Year" error={err(`vehicles.${i}.year`)}>
                  <Input inputMode="numeric" {...register(`vehicles.${i}.year`)} />
                </Field>
                <Field id={`veh-${i}-type`} label="Type">
                  <Select {...register(`vehicles.${i}.vehicle_type`)}>
                    {LOAD_VEHICLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {VEHICLE_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`veh-${i}-make`} label="Make">
                  <Input {...register(`vehicles.${i}.make`)} maxLength={60} />
                </Field>
                <Field id={`veh-${i}-model`} label="Model">
                  <Input {...register(`vehicles.${i}.model`)} maxLength={60} />
                </Field>
                <Field id={`veh-${i}-lot`} label="Lot / stock number">
                  <Input {...register(`vehicles.${i}.lot_number`)} maxLength={60} />
                </Field>
                <Field id={`veh-${i}-dealer`} label="Auction or dealer">
                  <Input {...register(`vehicles.${i}.auction_or_dealer_name`)} maxLength={200} />
                </Field>
                <Field id={`veh-${i}-pickup`} label="Pickup stop" error={err(`vehicles.${i}.pickup_sequence`)}>
                  <Select {...register(`vehicles.${i}.pickup_sequence`)}>
                    <option value="">—</option>
                    {stops.fields.map((_, s) => (
                      <option key={s} value={s + 1}>
                        Stop {s + 1}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`veh-${i}-delivery`} label="Delivery stop" error={err(`vehicles.${i}.delivery_sequence`)}>
                  <Select {...register(`vehicles.${i}.delivery_sequence`)}>
                    <option value="">—</option>
                    {stops.fields.map((_, s) => (
                      <option key={s} value={s + 1}>
                        Stop {s + 1}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <Checkbox {...register(`vehicles.${i}.operable`)} />
                <span>Runs and drives (operable)</span>
              </label>
              <Field id={`veh-${i}-keys`} label="Keys / title notes" className="mt-3">
                <Input {...register(`vehicles.${i}.keys_title_notes`)} maxLength={1000} />
              </Field>
              <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => vehicles.remove(i)}>
                <Trash2 aria-hidden="true" /> Remove vehicle {i + 1}
              </Button>
            </fieldset>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Internal note</CardTitle>
        </CardHeader>
        <CardBody>
          <Field id="internal_note" label="Note (not visible to the carrier)">
            <Textarea rows={3} {...register("internal_note")} maxLength={5000} />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-steel-600">The load starts as an opportunity. Send it to the carrier for approval from the load page.</p>
        <Button type="submit" size="lg" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? "Creating…" : "Create load"}
        </Button>
      </div>
    </form>
  );
}

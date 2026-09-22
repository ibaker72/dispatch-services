"use client";

import { Plus, Trash2 } from "lucide-react";
import { type FieldValues, type UseFormReturn, useFieldArray } from "react-hook-form";
import type { z } from "zod";
import { StepForm, errorAt } from "./step-form";
import type { ProgressState } from "@/app/(marketing)/apply/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { EQUIPMENT_KEYS, EQUIPMENT_LABELS } from "@/config/business";
import { US_STATES, titleCase } from "@/lib/utils";
import {
  DAYS,
  TRAILER_TYPES,
  businessStrict,
  contactStrict,
  driversStrict,
  equipmentStrict,
  factoringStrict,
  lanesStrict,
  preferencesStrict,
} from "@/lib/validation/application";

export interface StepProps {
  defaultValues: Record<string, unknown> | undefined;
  onProgress: (progress: ProgressState, values: Record<string, unknown>, completed: boolean) => void;
  onBack?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = UseFormReturn<any, unknown, any>;
/** React Hook Form types are invariant per schema; field helpers accept any step form. */
const loose = (form: unknown) => form as AnyForm;

const DAY_LABELS: Record<(typeof DAYS)[number], string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function StateChecklist({ form, name, legend, hint }: { form: AnyForm; name: string; legend: string; hint?: string }) {
  const selected: string[] = form.watch(name) ?? [];
  const error = errorAt(form.formState.errors, name);
  return (
    <fieldset aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="text-sm font-semibold text-navy-900">{legend}</legend>
      {hint ? <p className="text-sm text-steel-600">{hint}</p> : null}
      <details className="mt-2 rounded-md border border-steel-300 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sm text-steel-700">
          {selected.length ? `${selected.length} selected: ${selected.slice(0, 8).join(", ")}${selected.length > 8 ? "…" : ""}` : "Choose states"}
        </summary>
        <div className="grid max-h-64 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto border-t border-steel-200 p-3 sm:grid-cols-3">
          {US_STATES.map(([code, label]) => (
            <label key={code} className="flex items-center gap-2 py-1 text-sm">
              <Checkbox value={code} {...form.register(name)} />
              {label}
            </label>
          ))}
        </div>
      </details>
      {error ? (
        <p id={`${name}-error`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function StateSelect({ form, name, id, placeholder = "Select a state" }: { form: AnyForm; name: string; id?: string; placeholder?: string }) {
  return (
    <Select id={id} defaultValue="" {...form.register(name)}>
      <option value="">{placeholder}</option>
      {US_STATES.map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </Select>
  );
}

export function ContactStep(props: StepProps) {
  return (
    <StepForm
      step="contact"
      title="Contact information"
      description="Who should we talk to about your application?"
      schema={contactStrict}
      defaultValues={{ preferredContact: "phone", ...(props.defaultValues as z.input<typeof contactStrict>) }}
      onProgress={props.onProgress as never}
    >
      {(form) => {
        const e = form.formState.errors;
        return (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="fullName" label="Full name" required error={e.fullName?.message}>
              <Input autoComplete="name" {...form.register("fullName")} />
            </Field>
            <Field id="title" label="Title" hint="For example: Owner, Operations manager" error={e.title?.message}>
              <Input autoComplete="organization-title" {...form.register("title")} />
            </Field>
            <Field id="email" label="Email" required error={e.email?.message}>
              <Input type="email" autoComplete="email" {...form.register("email")} />
            </Field>
            <Field id="phone" label="Phone" required error={e.phone?.message}>
              <Input type="tel" autoComplete="tel" {...form.register("phone")} />
            </Field>
            <Field id="preferredContact" label="Best way to reach you" error={e.preferredContact?.message}>
              <Select {...form.register("preferredContact")}>
                <option value="phone">Phone call</option>
                <option value="text">Text message</option>
                <option value="email">Email</option>
              </Select>
            </Field>
          </div>
        );
      }}
    </StepForm>
  );
}

export function BusinessStep(props: StepProps) {
  return (
    <StepForm
      step="business"
      title="Business and authority"
      description="We dispatch only for carriers with their own active operating authority. We verify these details with FMCSA."
      schema={businessStrict}
      defaultValues={props.defaultValues as z.input<typeof businessStrict>}
      onProgress={props.onProgress as never}
      onBack={props.onBack}
    >
      {(form) => {
        const e = form.formState.errors;
        return (
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="legalName" label="Legal company name" required error={e.legalName?.message}>
                <Input autoComplete="organization" {...form.register("legalName")} />
              </Field>
              <Field id="dbaName" label="DBA (if any)" error={e.dbaName?.message}>
                <Input {...form.register("dbaName")} />
              </Field>
              <Field id="mcNumber" label="MC number" required error={e.mcNumber?.message}>
                <Input inputMode="numeric" placeholder="123456" {...form.register("mcNumber")} />
              </Field>
              <Field id="usdotNumber" label="USDOT number" required error={e.usdotNumber?.message}>
                <Input inputMode="numeric" placeholder="1234567" {...form.register("usdotNumber")} />
              </Field>
              <Field id="einLast4" label="EIN — last four digits only" hint="Never enter your full EIN or Social Security number." error={e.einLast4?.message}>
                <Input inputMode="numeric" maxLength={4} autoComplete="off" {...form.register("einLast4")} />
              </Field>
              <Field id="yearsInBusiness" label="Years in business" required error={e.yearsInBusiness?.message}>
                <Input type="number" inputMode="decimal" min={0} step="0.5" {...form.register("yearsInBusiness")} />
              </Field>
              <Field id="authorityActiveDate" label="Authority activation date" required error={e.authorityActiveDate?.message}>
                <Input type="date" {...form.register("authorityActiveDate")} />
              </Field>
            </div>
            <FieldGroup legend="Business address">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="addressLine1" label="Street address" required error={e.addressLine1?.message} className="sm:col-span-2">
                  <Input autoComplete="address-line1" {...form.register("addressLine1")} />
                </Field>
                <Field id="addressLine2" label="Suite / unit" error={e.addressLine2?.message} className="sm:col-span-2">
                  <Input autoComplete="address-line2" {...form.register("addressLine2")} />
                </Field>
                <Field id="city" label="City" required error={e.city?.message}>
                  <Input autoComplete="address-level2" {...form.register("city")} />
                </Field>
                <Field id="state" label="State" required error={e.state?.message}>
                  <StateSelect form={loose(form)} name="state" />
                </Field>
                <Field id="postalCode" label="ZIP code" required error={e.postalCode?.message}>
                  <Input inputMode="numeric" autoComplete="postal-code" {...form.register("postalCode")} />
                </Field>
              </div>
            </FieldGroup>
          </div>
        );
      }}
    </StepForm>
  );
}

export function EquipmentStep(props: StepProps) {
  const defaults = (props.defaultValues ?? {}) as Partial<z.input<typeof equipmentStrict>>;
  return (
    <StepForm
      step="equipment"
      title="Equipment"
      description="Tell us about the trucks and trailers you want dispatched."
      schema={equipmentStrict}
      defaultValues={{
        additionalEquipmentTypes: [],
        trailers: [],
        ...defaults,
        trucks: defaults.trucks?.length ? defaults.trucks : [{ unitNumber: "", equipmentType: defaults.primaryEquipmentType ?? "car_hauler" }],
      }}
      onProgress={props.onProgress as never}
      onBack={props.onBack}
    >
      {(form) => <EquipmentFields form={loose(form)} />}
    </StepForm>
  );
}

function EquipmentFields({ form }: { form: AnyForm }) {
  const trucks = useFieldArray({ control: form.control, name: "trucks" });
  const trailers = useFieldArray({ control: form.control, name: "trailers" });
  const e = form.formState.errors;
  return (
    <div className="space-y-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="primaryEquipmentType" label="Primary equipment" required error={errorAt(e, "primaryEquipmentType")}>
          <Select defaultValue="" {...form.register("primaryEquipmentType")}>
            <option value="">Select equipment</option>
            {EQUIPMENT_KEYS.map((k) => (
              <option key={k} value={k}>
                {EQUIPMENT_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="truckCount" label="Number of trucks" required error={errorAt(e, "truckCount")}>
          <Input type="number" inputMode="numeric" min={1} {...form.register("truckCount")} />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold text-navy-900">Other equipment you run</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {EQUIPMENT_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Checkbox value={k} {...form.register("additionalEquipmentTypes")} />
              {EQUIPMENT_LABELS[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <FieldGroup legend="Trucks" description="List each power unit. Capacity and payload help us filter loads you can legally haul.">
        {errorAt(e, "trucks") ? <p className="text-sm font-medium text-danger">{errorAt(e, "trucks")}</p> : null}
        <ul className="space-y-4">
          {trucks.fields.map((field, i) => (
            <li key={field.id} className="rounded-lg border border-steel-200 bg-paper p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Truck {i + 1}</p>
                {trucks.fields.length > 1 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => trucks.remove(i)} aria-label={`Remove truck ${i + 1}`}>
                    <Trash2 aria-hidden="true" /> Remove
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id={`trucks.${i}.unitNumber`} label="Unit number" error={errorAt(e, `trucks.${i}.unitNumber`)}>
                  <Input {...form.register(`trucks.${i}.unitNumber`)} />
                </Field>
                <Field id={`trucks.${i}.equipmentType`} label="Equipment" required error={errorAt(e, `trucks.${i}.equipmentType`)}>
                  <Select {...form.register(`trucks.${i}.equipmentType`)}>
                    {EQUIPMENT_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {EQUIPMENT_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`trucks.${i}.year`} label="Year" error={errorAt(e, `trucks.${i}.year`)}>
                  <Input type="number" inputMode="numeric" {...form.register(`trucks.${i}.year`)} />
                </Field>
                <Field id={`trucks.${i}.make`} label="Make" error={errorAt(e, `trucks.${i}.make`)}>
                  <Input {...form.register(`trucks.${i}.make`)} />
                </Field>
                <Field id={`trucks.${i}.model`} label="Model" error={errorAt(e, `trucks.${i}.model`)}>
                  <Input {...form.register(`trucks.${i}.model`)} />
                </Field>
                <Field id={`trucks.${i}.vehicleCapacity`} label="Vehicles it can carry" hint="Car haulers" error={errorAt(e, `trucks.${i}.vehicleCapacity`)}>
                  <Input type="number" inputMode="numeric" min={0} {...form.register(`trucks.${i}.vehicleCapacity`)} />
                </Field>
                <Field id={`trucks.${i}.maxPayloadLbs`} label="Max payload (lbs)" error={errorAt(e, `trucks.${i}.maxPayloadLbs`)}>
                  <Input type="number" inputMode="numeric" min={0} {...form.register(`trucks.${i}.maxPayloadLbs`)} />
                </Field>
              </div>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" onClick={() => trucks.append({ unitNumber: "", equipmentType: form.getValues("primaryEquipmentType") || "car_hauler" })}>
          <Plus aria-hidden="true" /> Add truck
        </Button>
      </FieldGroup>

      <FieldGroup legend="Trailers" description="Optional, but helps us match loads to your deck.">
        <ul className="space-y-4">
          {trailers.fields.map((field, i) => (
            <li key={field.id} className="rounded-lg border border-steel-200 bg-paper p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Trailer {i + 1}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => trailers.remove(i)} aria-label={`Remove trailer ${i + 1}`}>
                  <Trash2 aria-hidden="true" /> Remove
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field id={`trailers.${i}.trailerType`} label="Type" required error={errorAt(e, `trailers.${i}.trailerType`)}>
                  <Select {...form.register(`trailers.${i}.trailerType`)}>
                    {TRAILER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {titleCase(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`trailers.${i}.lengthFt`} label="Length (ft)" error={errorAt(e, `trailers.${i}.lengthFt`)}>
                  <Input type="number" inputMode="decimal" {...form.register(`trailers.${i}.lengthFt`)} />
                </Field>
                <Field id={`trailers.${i}.vehicleCapacity`} label="Vehicle capacity" error={errorAt(e, `trailers.${i}.vehicleCapacity`)}>
                  <Input type="number" inputMode="numeric" {...form.register(`trailers.${i}.vehicleCapacity`)} />
                </Field>
                <Field id={`trailers.${i}.maxPayloadLbs`} label="Max payload (lbs)" error={errorAt(e, `trailers.${i}.maxPayloadLbs`)}>
                  <Input type="number" inputMode="numeric" {...form.register(`trailers.${i}.maxPayloadLbs`)} />
                </Field>
              </div>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" onClick={() => trailers.append({ trailerType: "open_car_hauler" })}>
          <Plus aria-hidden="true" /> Add trailer
        </Button>
      </FieldGroup>
      <Field id="notes" label="Anything else about your equipment?" error={errorAt(e, "notes")}>
        <Textarea rows={3} {...form.register("notes")} />
      </Field>
    </div>
  );
}

export function DriversStep(props: StepProps) {
  const defaults = (props.defaultValues ?? {}) as Partial<z.input<typeof driversStrict>>;
  return (
    <StepForm
      step="drivers"
      title="Drivers"
      description="Who will be driving? We use contact details only to coordinate loads."
      schema={driversStrict}
      defaultValues={{ drivers: defaults.drivers?.length ? defaults.drivers : [{ fullName: "", isOwnerOperator: true }] }}
      onProgress={props.onProgress as never}
      onBack={props.onBack}
    >
      {(form) => <DriverFields form={loose(form)} />}
    </StepForm>
  );
}

function DriverFields({ form }: { form: AnyForm }) {
  const drivers = useFieldArray({ control: form.control, name: "drivers" });
  const e = form.formState.errors;
  return (
    <div className="space-y-4">
      {errorAt(e, "drivers") ? <p className="text-sm font-medium text-danger">{errorAt(e, "drivers")}</p> : null}
      <ul className="space-y-4">
        {drivers.fields.map((field, i) => (
          <li key={field.id} className="rounded-lg border border-steel-200 bg-paper p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Driver {i + 1}</p>
              {drivers.fields.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => drivers.remove(i)} aria-label={`Remove driver ${i + 1}`}>
                  <Trash2 aria-hidden="true" /> Remove
                </Button>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id={`drivers.${i}.fullName`} label="Full name" required error={errorAt(e, `drivers.${i}.fullName`)}>
                <Input {...form.register(`drivers.${i}.fullName`)} />
              </Field>
              <Field id={`drivers.${i}.phone`} label="Phone" error={errorAt(e, `drivers.${i}.phone`)}>
                <Input type="tel" {...form.register(`drivers.${i}.phone`)} />
              </Field>
              <Field id={`drivers.${i}.email`} label="Email" error={errorAt(e, `drivers.${i}.email`)}>
                <Input type="email" {...form.register(`drivers.${i}.email`)} />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <Checkbox {...form.register(`drivers.${i}.isOwnerOperator`)} />
              This driver is the owner-operator
            </label>
          </li>
        ))}
      </ul>
      <Button type="button" variant="secondary" onClick={() => drivers.append({ fullName: "", isOwnerOperator: false })}>
        <Plus aria-hidden="true" /> Add driver
      </Button>
    </div>
  );
}

export function LanesStep(props: StepProps) {
  const defaults = (props.defaultValues ?? {}) as Partial<z.input<typeof lanesStrict>>;
  return (
    <StepForm
      step="lanes"
      title="Lanes and operating regions"
      description="Where do you want to run, and where would you rather not go?"
      schema={lanesStrict}
      defaultValues={{ preferredStates: [], avoidStates: [], preferredLanes: [], ...defaults }}
      onProgress={props.onProgress as never}
      onBack={props.onBack}
    >
      {(form) => <LaneFields form={loose(form)} />}
    </StepForm>
  );
}

function LaneFields({ form }: { form: AnyForm }) {
  const lanes = useFieldArray({ control: form.control, name: "preferredLanes" });
  const e = form.formState.errors;
  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="homeBaseCity" label="Home base city" required error={errorAt(e, "homeBaseCity")}>
          <Input autoComplete="address-level2" {...form.register("homeBaseCity")} />
        </Field>
        <Field id="homeBaseState" label="Home base state" required error={errorAt(e, "homeBaseState")}>
          <StateSelect form={form} name="homeBaseState" />
        </Field>
      </div>
      <StateChecklist form={form} name="preferredStates" legend="Preferred states" hint="Where you are happy to run." />
      <StateChecklist form={form} name="avoidStates" legend="States to avoid" hint="We will not propose loads into these states." />
      <FieldGroup legend="Preferred lanes" description="Specific origin → destination lanes you like to run (optional).">
        <ul className="space-y-3">
          {lanes.fields.map((field, i) => (
            <li key={field.id} className="flex flex-wrap items-end gap-3">
              <Field id={`preferredLanes.${i}.originState`} label="From" error={errorAt(e, `preferredLanes.${i}.originState`)} className="min-w-40 flex-1">
                <StateSelect form={form} name={`preferredLanes.${i}.originState`} />
              </Field>
              <Field id={`preferredLanes.${i}.destinationState`} label="To" error={errorAt(e, `preferredLanes.${i}.destinationState`)} className="min-w-40 flex-1">
                <StateSelect form={form} name={`preferredLanes.${i}.destinationState`} />
              </Field>
              <Button type="button" variant="ghost" onClick={() => lanes.remove(i)} aria-label={`Remove lane ${i + 1}`}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" onClick={() => lanes.append({ originState: "", destinationState: "" })}>
          <Plus aria-hidden="true" /> Add lane
        </Button>
      </FieldGroup>
      <Field id="notes" label="Notes about lanes or regions" error={errorAt(e, "notes")}>
        <Textarea rows={3} {...form.register("notes")} />
      </Field>
    </div>
  );
}

export function PreferencesStep(props: StepProps) {
  return (
    <StepForm
      step="preferences"
      title="Revenue and scheduling preferences"
      description="These rules guide which loads we propose. You can change them later in your portal."
      schema={preferencesStrict}
      defaultValues={{ daysAvailable: ["mon", "tue", "wed", "thu", "fri"], ...(props.defaultValues as Partial<z.input<typeof preferencesStrict>>) }}
      onProgress={props.onProgress as never}
      onBack={props.onBack}
    >
      {(form) => {
        const e = form.formState.errors;
        return (
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field id="minRatePerMile" label="Minimum rate per loaded mile ($)" required error={e.minRatePerMile?.message}>
                <Input type="number" inputMode="decimal" step="0.05" min={0} {...form.register("minRatePerMile")} />
              </Field>
              <Field id="desiredWeeklyGross" label="Desired weekly gross ($)" hint="A target, not a promise" error={e.desiredWeeklyGross?.message}>
                <Input type="number" inputMode="numeric" min={0} {...form.register("desiredWeeklyGross")} />
              </Field>
              <Field id="maxDeadheadMiles" label="Max deadhead (miles)" error={e.maxDeadheadMiles?.message}>
                <Input type="number" inputMode="numeric" min={0} {...form.register("maxDeadheadMiles")} />
              </Field>
            </div>
            <fieldset>
              <legend className="text-sm font-semibold text-navy-900">Days available</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {DAYS.map((d) => (
                  <label key={d} className="flex items-center gap-2 text-sm">
                    <Checkbox value={d} {...form.register("daysAvailable")} />
                    {DAY_LABELS[d]}
                  </label>
                ))}
              </div>
              {e.daysAvailable?.message ? <p className="mt-1 text-sm font-medium text-danger">{e.daysAvailable.message}</p> : null}
            </fieldset>
            <Field id="notes" label="Scheduling notes" hint="Home time, preferred start days, anything we should plan around." error={e.notes?.message}>
              <Textarea rows={3} {...form.register("notes")} />
            </Field>
          </div>
        );
      }}
    </StepForm>
  );
}

export function FactoringStep(props: StepProps) {
  return (
    <StepForm
      step="factoring"
      title="Factoring"
      description="Brokers pay you or your factoring company directly — never us. This helps us send paperwork to the right place."
      schema={factoringStrict}
      defaultValues={{ noaAvailable: false, ...(props.defaultValues as z.input<typeof factoringStrict>) }}
      onProgress={props.onProgress as never}
      onBack={props.onBack}
    >
      {(form) => {
        const e = form.formState.errors;
        const status = form.watch("status");
        return (
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-semibold text-navy-900">How do you get paid for loads?</legend>
              <div className="mt-2 space-y-2">
                {[
                  ["factoring", "I use a factoring company"],
                  ["quick_pay", "I use broker quick pay"],
                  ["none", "I wait for standard broker terms"],
                ].map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input type="radio" value={value} className="size-4 accent-navy-900" {...form.register("status")} />
                    {label}
                  </label>
                ))}
              </div>
              {e.status?.message ? <p className="mt-1 text-sm font-medium text-danger">{e.status.message}</p> : null}
            </fieldset>
            {status === "factoring" ? (
              <>
                <Field id="companyName" label="Factoring company name" required error={e.companyName?.message}>
                  <Input {...form.register("companyName")} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox {...form.register("noaAvailable")} />I have a notice of assignment (NOA) I can upload
                </label>
              </>
            ) : null}
          </div>
        );
      }}
    </StepForm>
  );
}

export type { FieldValues };

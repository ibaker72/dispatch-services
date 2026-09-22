"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { joinLeaseOnWaitlist } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { track } from "@/lib/analytics/client";
import { US_STATES } from "@/lib/utils";
import { waitlistSchema } from "@/lib/validation/public-forms";

type FormInput = z.input<typeof waitlistSchema>;

export function WaitlistForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());
  const form = useForm<FormInput>({ resolver: zodResolver(waitlistSchema) });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const result = await joinLeaseOnWaitlist({ ...values, started_at: startedAt });
    if (result.ok) {
      track("lease_on_waitlist_signup");
      setDone(true);
    } else {
      for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) form.setError(key as keyof FormInput, { message: messages[0] });
      setError(result.error);
    }
  });

  if (done) {
    return (
      <Alert tone="success" title="You are on the list" live>
        Thanks. We will only contact you about the lease-on program if and when it becomes available.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {error ? (
        <Alert tone="danger" live>
          {error}
        </Alert>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="full_name" label="Full name" required error={errors.full_name?.message}>
          <Input autoComplete="name" {...form.register("full_name")} />
        </Field>
        <Field id="email" label="Email" required error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field id="phone" label="Phone" error={errors.phone?.message}>
          <Input type="tel" autoComplete="tel" {...form.register("phone")} />
        </Field>
        <Field id="city" label="City" error={errors.city?.message}>
          <Input autoComplete="address-level2" {...form.register("city")} />
        </Field>
        <Field id="state" label="State" error={errors.state?.message}>
          <Select defaultValue="" {...form.register("state")}>
            <option value="">Select a state</option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cdl_class" label="CDL class" error={errors.cdl_class?.message}>
          <Select defaultValue="" {...form.register("cdl_class", { setValueAs: (v) => (v === "" ? undefined : v) })}>
            <option value="">Select</option>
            <option value="A">Class A</option>
            <option value="B">Class B</option>
            <option value="none">No CDL</option>
          </Select>
        </Field>
        <Field id="years_experience" label="Years of driving experience" error={errors.years_experience?.message}>
          <Input type="number" inputMode="numeric" min={0} max={60} {...form.register("years_experience", { setValueAs: (v) => (v === "" ? undefined : v) })} />
        </Field>
        <Field id="equipment_interest" label="Equipment" error={errors.equipment_interest?.message}>
          <Select defaultValue="" {...form.register("equipment_interest", { setValueAs: (v) => (v === "" ? undefined : v) })}>
            <option value="">Select</option>
            <option value="car_hauler">Car hauler</option>
            <option value="hotshot">Hotshot</option>
            <option value="box_truck">Box truck</option>
            <option value="dry_van">Dry van</option>
          </Select>
        </Field>
      </div>
      <Field id="owns_truck" label="Do you own your truck?" error={errors.owns_truck?.message}>
        <Select defaultValue="" {...form.register("owns_truck", { setValueAs: (v) => (v === "" ? undefined : v) })}>
          <option value="">Select</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </Field>
      <Field id="message" label="Anything else we should know?" error={errors.message?.message}>
        <Textarea rows={4} {...form.register("message")} />
      </Field>
      <div className="flex gap-3">
        <Checkbox id="consent" aria-describedby={errors.consent ? "consent-error" : undefined} {...form.register("consent")} />
        <div>
          <label htmlFor="consent" className="text-sm text-steel-700">
            I understand the lease-on program is not available today, may never launch, and joining the waitlist is not an offer of a lease or
            employment.
          </label>
          {errors.consent ? (
            <p id="consent-error" className="mt-1 text-sm font-medium text-danger">
              {errors.consent.message}
            </p>
          ) : null}
        </div>
      </div>
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="company_website">Company website</label>
        <input id="company_website" tabIndex={-1} autoComplete="off" {...form.register("company_website")} />
      </div>
      <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Saving…" : "Join the waitlist"}
      </Button>
    </form>
  );
}

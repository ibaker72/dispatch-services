"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { submitContact } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { track } from "@/lib/analytics/client";
import { CONTACT_TOPICS, contactSchema } from "@/lib/validation/public-forms";

type FormInput = z.input<typeof contactSchema>;

export function ContactForm() {
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [startedAt] = useState(() => Date.now());
  const form = useForm<FormInput>({ resolver: zodResolver(contactSchema), defaultValues: { topic: "dispatch", started_at: startedAt } });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(null);
    const result = await submitContact({ ...values, started_at: startedAt });
    if (result.ok) {
      track("contact_submitted", { topic: values.topic });
      form.reset({ topic: "dispatch", started_at: startedAt });
      setStatus({ tone: "success", text: "Thanks — your message was sent. We usually reply within one business day." });
    } else {
      for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(key as keyof FormInput, { message: messages[0] });
      }
      setStatus({ tone: "danger", text: result.error });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {status ? (
        <Alert tone={status.tone} live>
          {status.text}
        </Alert>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Name" required error={errors.name?.message}>
          <Input autoComplete="name" {...form.register("name")} />
        </Field>
        <Field id="email" label="Email" required error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field id="phone" label="Phone" error={errors.phone?.message}>
          <Input type="tel" autoComplete="tel" {...form.register("phone")} />
        </Field>
        <Field id="topic" label="Topic" required error={errors.topic?.message}>
          <Select {...form.register("topic")}>
            {CONTACT_TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="message" label="Message" required error={errors.message?.message} hint="Please do not include bank details or Social Security numbers.">
        <Textarea rows={6} {...form.register("message")} />
      </Field>
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="company_website">Company website</label>
        <input id="company_website" tabIndex={-1} autoComplete="off" {...form.register("company_website")} />
      </div>
      <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}

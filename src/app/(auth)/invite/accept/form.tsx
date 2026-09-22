"use client";

import { useState } from "react";
import { acceptInvitation } from "../../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function AcceptInvitationForm({ token, defaultName }: { token?: string; defaultName: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const d = new FormData(e.currentTarget);
        const result = await acceptInvitation({
          token,
          fullName: String(d.get("fullName") ?? ""),
          phone: String(d.get("phone") ?? ""),
          password: String(d.get("password") ?? ""),
          confirm: String(d.get("confirm") ?? ""),
        });
        if (result && !result.ok) {
          setError(result.error);
          setErrors(result.fieldErrors ?? {});
        }
        setPending(false);
      }}
    >
      {error ? <Alert tone="danger" live>{error}</Alert> : null}
      <Field id="fullName" label="Your name" required error={errors.fullName}>
        <Input name="fullName" autoComplete="name" defaultValue={defaultName} />
      </Field>
      <Field id="phone" label="Mobile phone" error={errors.phone}>
        <Input name="phone" type="tel" autoComplete="tel" />
      </Field>
      <Field id="password" label="Password" hint="At least 12 characters, including letters and a number." required error={errors.password}>
        <Input name="password" type="password" autoComplete="new-password" />
      </Field>
      <Field id="confirm" label="Confirm password" required error={errors.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Setting up…" : "Continue"}
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { updatePassword } from "../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function NewPasswordForm() {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const data = new FormData(e.currentTarget);
        const result = await updatePassword({ password: String(data.get("password")), confirm: String(data.get("confirm")) });
        if (result && !result.ok) {
          setError(result.error);
          setErrors(result.fieldErrors ?? {});
        }
        setPending(false);
      }}
    >
      {error ? (
        <Alert tone="danger" live>
          {error}
        </Alert>
      ) : null}
      <Field id="password" label="New password" error={errors.password}>
        <Input type="password" name="password" autoComplete="new-password" />
      </Field>
      <Field id="confirm" label="Confirm new password" error={errors.confirm}>
        <Input type="password" name="confirm" autoComplete="new-password" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}

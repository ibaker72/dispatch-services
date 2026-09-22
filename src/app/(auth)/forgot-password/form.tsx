"use client";

import Link from "next/link";
import { useState } from "react";
import { requestPasswordReset } from "../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  return state === "sent" ? (
    <Alert tone="success" title="Check your email" live>
      If an account exists for that address, a reset link is on its way. <Link href="/login" className="underline">Back to log in</Link>
    </Alert>
  ) : (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        setError(null);
        const email = String(new FormData(e.currentTarget).get("email") ?? "");
        const result = await requestPasswordReset({ email });
        if (result.ok) setState("sent");
        else {
          setError(result.fieldErrors?.email?.[0] ?? result.error);
          setState("idle");
        }
      }}
    >
      {error ? (
        <Alert tone="danger" live>
          {error}
        </Alert>
      ) : null}
      <Field id="email" label="Email">
        <Input type="email" name="email" autoComplete="email" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}

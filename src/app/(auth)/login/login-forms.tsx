"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { sendMagicLink, signInWithPassword } from "../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const passwordForm = z.object({ email: z.email("Enter a valid email address"), password: z.string().min(1, "Enter your password") });
const magicForm = z.object({ email: z.email("Enter a valid email address") });

export function LoginForms({ next }: { next?: string }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const pw = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm) });
  const magic = useForm<z.infer<typeof magicForm>>({ resolver: zodResolver(magicForm) });

  const onPassword = pw.handleSubmit(async (values) => {
    setError(null);
    const result = await signInWithPassword({ ...values, next });
    if (result && !result.ok) setError(result.error);
  });
  const onMagic = magic.handleSubmit(async (values) => {
    setError(null);
    const result = await sendMagicLink({ ...values, next });
    if (result.ok) setSent(true);
    else setError(result.error);
  });

  return (
    <div className="space-y-5">
      {error ? (
        <Alert tone="danger" live>
          {error}
        </Alert>
      ) : null}
      {mode === "password" ? (
        <form onSubmit={onPassword} noValidate className="space-y-4">
          <Field id="email" label="Email" error={pw.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...pw.register("email")} />
          </Field>
          <Field id="password" label="Password" error={pw.formState.errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...pw.register("password")} />
          </Field>
          <div className="flex justify-end">
            <Link href="/forgot-password" className="text-sm font-medium text-navy-700 underline underline-offset-2">
              Forgot password?
            </Link>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={pw.formState.isSubmitting}>
            {pw.formState.isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      ) : sent ? (
        <Alert tone="success" title="Check your email" live>
          If an account exists for that address, we sent a sign-in link. It expires soon and works once.
        </Alert>
      ) : (
        <form onSubmit={onMagic} noValidate className="space-y-4">
          <Field id="magic-email" label="Email" hint="We will email you a one-time sign-in link." error={magic.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...magic.register("email")} />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={magic.formState.isSubmitting}>
            {magic.formState.isSubmitting ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </form>
      )}
      <div className="border-t border-steel-200 pt-4 text-center">
        <Button
          type="button"
          variant="link"
          onClick={() => {
            setMode(mode === "password" ? "magic" : "password");
            setError(null);
            setSent(false);
          }}
        >
          {mode === "password" ? "Sign in with an email link instead" : "Sign in with a password instead"}
        </Button>
      </div>
    </div>
  );
}

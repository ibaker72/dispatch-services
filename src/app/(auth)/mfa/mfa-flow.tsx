"use client";

import { useState } from "react";
import { startTotpEnrollment, verifyTotp } from "../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function MfaFlow({ factorId: existing, next }: { factorId: string | null; next?: string }) {
  const [enrollment, setEnrollment] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const factorId = existing ?? enrollment?.factorId ?? null;

  if (!factorId) {
    return (
      <div className="space-y-4">
        {error ? <Alert tone="danger" live>{error}</Alert> : null}
        <Button
          size="lg"
          className="w-full"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const result = await startTotpEnrollment();
            setPending(false);
            if (result.ok) setEnrollment(result.data);
            else setError(result.error);
          }}
        >
          {pending ? "Preparing…" : "Set up authenticator app"}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
        const result = await verifyTotp({ factorId, code, next });
        if (result && !result.ok) setError(result.fieldErrors?.code?.[0] ?? result.error);
        setPending(false);
      }}
    >
      {enrollment ? (
        <div className="space-y-3 rounded-lg border border-steel-200 bg-paper p-4 text-sm">
          <p>Scan this QR code with your authenticator app, then enter the code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URI SVG from Supabase Auth */}
          <img src={enrollment.qrCode} alt="QR code for your authenticator app" width={180} height={180} className="mx-auto bg-white p-2" />
          <p>
            Can&rsquo;t scan? Enter this key manually: <code className="font-mono break-all">{enrollment.secret}</code>
          </p>
        </div>
      ) : null}
      {error ? <Alert tone="danger" live>{error}</Alert> : null}
      <Field id="code" label="6-digit code">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} pattern="[0-9 ]*" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}

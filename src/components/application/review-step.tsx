"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import type { DocumentRequirement, UploadedDocument } from "./documents-step";
import { submitApplication } from "@/app/(marketing)/apply/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { EQUIPMENT_LABELS, type EquipmentKey } from "@/config/business";
import { track } from "@/lib/analytics/client";
import type { ApplicationQuestion } from "@/lib/settings";
import { APPLICATION_STEPS, type StepKey, consentStrict } from "@/lib/validation/application";

type FormData = Partial<Record<StepKey, Record<string, unknown>>>;

function summary(key: StepKey, data: Record<string, unknown> | undefined): Array<[string, string]> {
  const d = data ?? {};
  const s = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.join(", ") : "—") : String(v));
  switch (key) {
    case "contact":
      return [["Name", s(d.fullName)], ["Email", s(d.email)], ["Phone", s(d.phone)]];
    case "business":
      return [["Legal name", s(d.legalName)], ["MC / USDOT", `${s(d.mcNumber)} / ${s(d.usdotNumber)}`], ["Authority since", s(d.authorityActiveDate)]];
    case "equipment":
      return [
        ["Primary equipment", d.primaryEquipmentType ? EQUIPMENT_LABELS[d.primaryEquipmentType as EquipmentKey] : "—"],
        ["Trucks", s(d.truckCount)],
      ];
    case "drivers":
      return [["Drivers", s(((d.drivers as Array<{ fullName?: string }>) ?? []).map((x) => x.fullName).filter(Boolean))]];
    case "lanes":
      return [["Home base", `${s(d.homeBaseCity)}, ${s(d.homeBaseState)}`], ["Preferred states", s(d.preferredStates)], ["Avoid", s(d.avoidStates)]];
    case "preferences":
      return [["Minimum rate", d.minRatePerMile ? `$${d.minRatePerMile}/mi` : "—"], ["Days", s(d.daysAvailable)]];
    case "factoring":
      return [["Payment method", s(d.status)], ["Factoring company", s(d.companyName)]];
    case "documents":
      return [["Insurance expires", s(d.insuranceExpirationDate)]];
    default:
      return [];
  }
}

export function ReviewStep({
  formData,
  documents,
  requirements,
  questions,
  onEdit,
  onBack,
  onSubmitted,
}: {
  formData: FormData;
  documents: UploadedDocument[];
  requirements: DocumentRequirement[];
  questions: ApplicationQuestion[];
  onEdit: (step: number) => void;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const form = useForm<z.input<typeof consentStrict>>({ resolver: zodResolver(consentStrict), defaultValues: { custom: {} } });
  const [problems, setProblems] = useState<{ steps: Array<{ key: string; title: string; message: string }>; docs: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (consent) => {
    setError(null);
    setProblems(null);
    const result = await submitApplication({ consent });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.data.submitted) {
      setProblems({ steps: result.data.incompleteSteps ?? [], docs: result.data.missingDocuments ?? [] });
      return;
    }
    track("application_submitted", {});
    onSubmitted();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <div>
        <h2 tabIndex={-1} className="text-xl font-semibold">
          Review and submit
        </h2>
        <p className="mt-1 text-sm text-steel-600">Check your answers. You can edit any section before submitting.</p>
      </div>
      {error ? (
        <Alert tone="danger" live>
          {error}
        </Alert>
      ) : null}
      {problems ? (
        <Alert tone="warning" live title="A few things are still needed">
          <ul className="list-disc pl-5">
            {problems.steps.map((p) => (
              <li key={`${p.key}-${p.message}`}>
                {p.title}: {p.message}
              </li>
            ))}
            {problems.docs.map((d) => (
              <li key={d}>Upload: {d}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <dl className="divide-y divide-steel-200 rounded-lg border border-steel-200 bg-white">
        {APPLICATION_STEPS.filter((s) => s.key !== "consent").map((step) => (
          <div key={step.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start">
            <dt className="text-sm font-semibold text-navy-900">{step.title}</dt>
            <dd className="text-sm text-steel-700">
              {summary(step.key, formData[step.key]).map(([label, value]) => (
                <p key={label}>
                  <span className="text-steel-600">{label}:</span> {value}
                </p>
              ))}
              {step.key === "documents" ? (
                <p>
                  <span className="text-steel-600">Uploaded:</span>{" "}
                  {requirements
                    .filter((r) => documents.some((d) => d.doc_type === r.doc_type))
                    .map((r) => r.label)
                    .join(", ") || "—"}
                </p>
              ) : null}
            </dd>
            <dd>
              <Button type="button" variant="link" onClick={() => onEdit(step.number)}>
                Edit<span className="sr-only"> {step.title}</span>
              </Button>
            </dd>
          </div>
        ))}
      </dl>

      {questions.length ? (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">A few more questions</legend>
          {questions.map((q) => (
            <Field key={q.id} id={`custom.${q.id}`} label={q.label} required={q.required}>
              {q.type === "textarea" ? (
                <Textarea rows={3} {...form.register(`custom.${q.id}`)} />
              ) : q.type === "select" || q.type === "yes_no" ? (
                <Select defaultValue="" {...form.register(`custom.${q.id}`)}>
                  <option value="">Select</option>
                  {(q.type === "yes_no" ? ["Yes", "No"] : (q.options ?? [])).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...form.register(`custom.${q.id}`)} />
              )}
            </Field>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Confirmations</legend>
        {(
          [
            ["accurate", "The information in this application is accurate and complete to the best of my knowledge."],
            ["authorizeVerification", "I authorize you to verify my operating authority, insurance and safety record with FMCSA and my insurance provider."],
            [
              "acknowledgeDisclosure",
              <>
                I have read the{" "}
                <Link href="/dispatch-disclosure" target="_blank" className="font-medium text-navy-700 underline">
                  dispatch relationship disclosure
                </Link>{" "}
                and understand you are a dispatch service, not a broker or carrier, and that I approve every load.
              </>,
            ],
            [
              "agreeTerms",
              <>
                I agree to the{" "}
                <Link href="/terms" target="_blank" className="font-medium text-navy-700 underline">
                  terms of service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" target="_blank" className="font-medium text-navy-700 underline">
                  privacy policy
                </Link>
                .
              </>,
            ],
          ] as const
        ).map(([name, label]) => (
          <div key={name}>
            <div className="flex gap-3">
              <Checkbox id={name} aria-describedby={e[name] ? `${name}-error` : undefined} {...form.register(name)} />
              <label htmlFor={name} className="text-sm text-steel-700">
                {label}
              </label>
            </div>
            {e[name]?.message ? (
              <p id={`${name}-error`} className="mt-1 ml-8 text-sm font-medium text-danger">
                {e[name]?.message}
              </p>
            ) : null}
          </div>
        ))}
      </fieldset>

      <p className="text-sm text-steel-600">
        Submitting an application does not create a contract. If approved, you will review and sign a dispatch agreement before any load is
        booked.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-steel-200 pt-5">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" size="lg" variant="accent" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Submitting…" : "Submit application"}
        </Button>
      </div>
    </form>
  );
}

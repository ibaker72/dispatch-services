"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type DocumentRequirement, DocumentsStep, type UploadedDocument } from "./documents-step";
import { ReviewStep } from "./review-step";
import {
  BusinessStep,
  ContactStep,
  DriversStep,
  EquipmentStep,
  FactoringStep,
  LanesStep,
  PreferencesStep,
  type StepProps,
} from "./steps";
import { type ProgressState, emailResumeLink } from "@/app/(marketing)/apply/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import type { ApplicationQuestion } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { APPLICATION_STEPS, type StepKey } from "@/lib/validation/application";

export interface WizardInitial {
  status: ProgressState["status"];
  currentStep: number;
  completedSteps: number[];
  formData: Partial<Record<StepKey, Record<string, unknown>>>;
  documents: UploadedDocument[];
  requirements: DocumentRequirement[];
  questions: ApplicationQuestion[];
  informationRequest: string | null;
}

export function ApplicationWizard({ initial }: { initial: WizardInitial }) {
  const router = useRouter();
  const [progress, setProgress] = useState({ currentStep: initial.currentStep, completedSteps: initial.completedSteps });
  const [active, setActive] = useState(Math.min(initial.currentStep, APPLICATION_STEPS.length));
  const [formData, setFormData] = useState(initial.formData);
  const [documents, setDocuments] = useState(initial.documents);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  const reachable = (n: number) => n <= Math.max(progress.currentStep, ...progress.completedSteps.map((s) => s + 1), 1);

  function go(n: number) {
    setActive(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onProgress(key: StepKey) {
    return (p: ProgressState, values: Record<string, unknown>, completed: boolean) => {
      setProgress({ currentStep: p.currentStep, completedSteps: p.completedSteps });
      setFormData((prev) => ({ ...prev, [key]: values }));
      if (completed) {
        const step = APPLICATION_STEPS.find((s) => s.key === key)!;
        track("application_step_completed", { step: step.number, step_key: key });
        go(Math.min(step.number + 1, APPLICATION_STEPS.length));
      }
    };
  }

  const step = APPLICATION_STEPS[active - 1]!;
  const props = (key: StepKey): StepProps => ({
    defaultValues: formData[key],
    onProgress: onProgress(key),
    onBack: active > 1 ? () => go(active - 1) : undefined,
  });

  async function sendResume() {
    const result = await emailResumeLink();
    setResumeMessage(result.ok ? "We emailed you a link to continue on any device." : result.error);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Application steps" className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 text-sm text-steel-600">
          Step {active} of {APPLICATION_STEPS.length}
        </p>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-steel-200" aria-hidden="true">
          <div className="h-full bg-navy-900 transition-all" style={{ width: `${(progress.completedSteps.length / APPLICATION_STEPS.length) * 100}%` }} />
        </div>
        <ol className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible">
          {APPLICATION_STEPS.map((s) => {
            const done = progress.completedSteps.includes(s.number);
            const current = s.number === active;
            return (
              <li key={s.key} className="shrink-0">
                <button
                  type="button"
                  disabled={!reachable(s.number)}
                  onClick={() => go(s.number)}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
                    current ? "bg-navy-900 text-white" : "text-steel-700 hover:bg-paper-2",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      current ? "bg-accent text-navy-900" : done ? "bg-success text-white" : "bg-steel-200 text-steel-700",
                    )}
                  >
                    {done && !current ? <Check className="size-3.5" aria-hidden="true" /> : s.number}
                  </span>
                  <span className="whitespace-nowrap lg:whitespace-normal">{s.title}</span>
                  {done ? <span className="sr-only">(completed)</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 hidden border-t border-steel-200 pt-4 lg:block">
          <Button type="button" variant="link" onClick={() => void sendResume()}>
            Email me a link to finish later
          </Button>
          {resumeMessage ? (
            <p role="status" className="mt-1 text-xs text-steel-600">
              {resumeMessage}
            </p>
          ) : null}
        </div>
      </nav>

      <div className="min-w-0 rounded-lg border border-steel-200 bg-white p-5 sm:p-8">
        {initial.status === "information_requested" && initial.informationRequest ? (
          <Alert tone="warning" title="We need a little more information" className="mb-6">
            {initial.informationRequest}
          </Alert>
        ) : null}
        <div key={step.key}>
          {step.key === "contact" && <ContactStep {...props("contact")} />}
          {step.key === "business" && <BusinessStep {...props("business")} />}
          {step.key === "equipment" && <EquipmentStep {...props("equipment")} />}
          {step.key === "drivers" && <DriversStep {...props("drivers")} />}
          {step.key === "lanes" && <LanesStep {...props("lanes")} />}
          {step.key === "preferences" && <PreferencesStep {...props("preferences")} />}
          {step.key === "factoring" && <FactoringStep {...props("factoring")} />}
          {step.key === "documents" && (
            <DocumentsStep {...props("documents")} documents={documents} requirements={initial.requirements} onDocumentsChange={setDocuments} />
          )}
          {step.key === "consent" && (
            <ReviewStep
              formData={formData}
              documents={documents}
              requirements={initial.requirements}
              questions={initial.questions}
              onEdit={go}
              onBack={() => go(active - 1)}
              onSubmitted={() => router.refresh()}
            />
          )}
        </div>
        <div className="mt-6 border-t border-steel-200 pt-4 lg:hidden">
          <Button type="button" variant="link" onClick={() => void sendResume()}>
            Email me a link to finish later
          </Button>
          {resumeMessage ? (
            <p role="status" className="mt-1 text-xs text-steel-600">
              {resumeMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

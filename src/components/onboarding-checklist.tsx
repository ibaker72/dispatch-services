import { CheckCircle2, Circle } from "lucide-react";

export interface OnboardingStep {
  key: string;
  label: string;
  complete: boolean;
  uploaded?: boolean;
  published?: boolean;
}

export function parseOnboarding(value: unknown): { steps: OnboardingStep[]; complete: boolean } {
  const v = (value ?? {}) as { steps?: OnboardingStep[]; complete?: boolean };
  return { steps: Array.isArray(v.steps) ? v.steps : [], complete: v.complete === true };
}

/** Activation checklist computed by the database (the same rules gate activation). */
export function OnboardingChecklist({ steps, hint }: { steps: OnboardingStep[]; hint?: (step: OnboardingStep) => React.ReactNode }) {
  const done = steps.filter((s) => s.complete).length;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-steel-100" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Onboarding progress">
          <div className="h-full rounded-full bg-success" style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
        </div>
        <span className="text-sm font-medium text-steel-700">
          {done} of {steps.length}
        </span>
      </div>
      <ul className="space-y-2">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-sm">
            {s.complete ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-steel-400" aria-hidden="true" />
            )}
            <span>
              <span className={s.complete ? "text-steel-700" : "font-medium text-navy-900"}>{s.label}</span>
              <span className="sr-only">{s.complete ? " (done)" : " (not done)"}</span>
              {!s.complete && s.uploaded ? <span className="ml-1 text-xs text-warning">uploaded, awaiting review</span> : null}
              {!s.complete && s.published === false ? <span className="ml-1 text-xs text-danger">no published version yet</span> : null}
              {!s.complete && hint ? <span className="block text-xs text-steel-600">{hint(s)}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

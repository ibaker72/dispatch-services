"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import * as React from "react";
import { type DefaultValues, type FieldValues, type Path, type UseFormReturn, useForm } from "react-hook-form";
import type { z } from "zod";
import { type ProgressState, saveApplicationStep } from "@/app/(marketing)/apply/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { StepKey } from "@/lib/validation/application";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-sm text-steel-600">
      {state === "saving" ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving…
        </>
      ) : state === "saved" ? (
        <>
          <Check className="size-4 text-success" aria-hidden="true" /> Progress saved
        </>
      ) : state === "error" ? (
        <>
          <AlertCircle className="size-4 text-danger" aria-hidden="true" /> Not saved — check your connection
        </>
      ) : null}
    </p>
  );
}

interface StepFormProps<S extends z.ZodType<FieldValues, FieldValues>> {
  step: StepKey;
  title: string;
  description?: string;
  schema: S;
  defaultValues: DefaultValues<z.input<S>>;
  onProgress: (progress: ProgressState, values: z.output<S>, completed: boolean) => void;
  onBack?: () => void;
  submitLabel?: string;
  children: (form: UseFormReturn<z.input<S>, unknown, z.output<S>>) => React.ReactNode;
}

/**
 * Wraps one application step: client validation with the shared Zod schema,
 * debounced autosave (lenient) and strict server validation on Continue.
 */
export function StepForm<S extends z.ZodType<FieldValues, FieldValues>>({
  step,
  title,
  description,
  schema,
  defaultValues,
  onProgress,
  onBack,
  submitLabel = "Save and continue",
  children,
}: StepFormProps<S>) {
  const form = useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema as never) as never,
    defaultValues,
    mode: "onBlur",
  });
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [formError, setFormError] = React.useState<string | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  const lastSaved = React.useRef(JSON.stringify(defaultValues ?? {}));
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const onProgressRef = React.useRef(onProgress);
  React.useEffect(() => {
    onProgressRef.current = onProgress;
  });

  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const { subscribe } = form;
  React.useEffect(() => {
    const unsubscribe = subscribe({
      formState: { values: true },
      callback: ({ values }) => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(async () => {
          const json = JSON.stringify(values);
          if (json === lastSaved.current) return;
          setSaveState("saving");
          const result = await saveApplicationStep({
            step,
            data: values as Record<string, unknown>,
            complete: false,
          });
          if (result.ok) {
            lastSaved.current = json;
            setSaveState("saved");
            onProgressRef.current(result.data, values as z.output<S>, false);
          } else {
            setSaveState("error");
          }
        }, 1200);
      },
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer.current);
    };
  }, [subscribe, step]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) =>
    form.handleSubmit(async (values) => {
      window.clearTimeout(timer.current);
      setFormError(null);
      setSaveState("saving");
      const result = await saveApplicationStep({
        step,
        data: values as Record<string, unknown>,
        complete: true,
      });
      if (!result.ok) {
        setSaveState("error");
        setFormError(result.error);
        for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(key as Path<z.input<S>>, { message: messages[0] });
        }
        return;
      }
      lastSaved.current = JSON.stringify(form.getValues());
      setSaveState("saved");
      onProgress(result.data, values, true);
    })(event);

  const errorCount = Object.keys(form.formState.errors).length;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-steel-600">{description}</p> : null}
        </div>
        <SaveIndicator state={saveState} />
      </div>
      {formError || (form.formState.isSubmitted && errorCount > 0) ? (
        <Alert tone="danger" live title={formError ?? "Please fix the highlighted fields."}>
          {errorCount > 0 ? `${errorCount} field${errorCount === 1 ? "" : "s"} need attention.` : null}
        </Alert>
      ) : null}
      {children(form)}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-steel-200 pt-5">
        {onBack ? (
          <Button type="button" variant="secondary" onClick={onBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Reads a (possibly nested) field error message. */
export function errorAt(errors: unknown, path: string): string | undefined {
  let node: unknown = errors;
  for (const part of path.split(".")) {
    if (node && typeof node === "object") node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  const message = (node as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}

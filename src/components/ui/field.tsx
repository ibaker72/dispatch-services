import * as React from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | string[];
  required?: boolean;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }>;
}

/**
 * Label + control + hint + error, wired with aria-describedby / aria-invalid
 * so screen readers announce hints and validation messages.
 */
export function Field({ id, label, hint, error, required, className, children }: FieldProps) {
  const message = Array.isArray(error) ? error[0] : error;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = message ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-navy-900">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-steel-600">
          {hint}
        </p>
      ) : null}
      {React.cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": message ? true : undefined,
        required: required || undefined,
      })}
      {message ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function FieldGroup({ legend, description, children, className }: { legend: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn("space-y-4", className)}>
      <legend className="text-base font-semibold text-navy-900">{legend}</legend>
      {description ? <p className="-mt-2 text-sm text-steel-600">{description}</p> : null}
      {children}
    </fieldset>
  );
}

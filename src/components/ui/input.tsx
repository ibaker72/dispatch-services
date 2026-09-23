"use client";

import * as React from "react";
import { FIELD_CONTROL, FieldControlContext } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export const controlClasses =
  "w-full rounded-md border border-steel-500 bg-white px-3 text-[15px] text-steel-900 placeholder:text-steel-500 disabled:cursor-not-allowed disabled:bg-steel-100 aria-[invalid=true]:border-danger";

/** Merges the surrounding <Field>'s id and aria wiring into a control's props. */
function useFieldControl<P extends { id?: string; required?: boolean }>(props: P): P {
  const field = React.useContext(FieldControlContext);
  if (!field) return props;
  return {
    ...props,
    id: field.id,
    "aria-describedby": field["aria-describedby"],
    "aria-invalid": field["aria-invalid"],
    required: props.required || field.required,
  };
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-11", className)} {...useFieldControl(props)} />;
}
Input[FIELD_CONTROL] = true;

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-24 py-2", className)} {...useFieldControl(props)} />;
}
Textarea[FIELD_CONTROL] = true;

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(controlClasses, "h-11 pr-8", className)} {...useFieldControl(props)}>
      {children}
    </select>
  );
}
Select[FIELD_CONTROL] = true;

export function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return <input type="checkbox" className={cn("mt-0.5 size-5 shrink-0 accent-navy-900", className)} {...props} />;
}

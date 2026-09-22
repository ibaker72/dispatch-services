import type * as React from "react";
import { cn } from "@/lib/utils";

export const controlClasses =
  "w-full rounded-md border border-steel-500 bg-white px-3 text-[15px] text-steel-900 placeholder:text-steel-500 disabled:cursor-not-allowed disabled:bg-steel-100 aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-24 py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(controlClasses, "h-11 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return <input type="checkbox" className={cn("mt-0.5 size-5 shrink-0 accent-navy-900", className)} {...props} />;
}

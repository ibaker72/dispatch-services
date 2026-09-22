import type * as React from "react";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "carrier" | "company" | "warning";
  className?: string;
}) {
  const accent = {
    default: "border-l-steel-300",
    carrier: "border-l-navy-600",
    company: "border-l-accent",
    warning: "border-l-warning",
  }[tone];
  return (
    <div className={cn("rounded-lg border border-steel-200 border-l-4 bg-white px-4 py-3 shadow-[var(--shadow-card)]", accent, className)}>
      <p className="text-xs font-semibold tracking-wide text-steel-600 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy-900 tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-steel-600">{hint}</p> : null}
    </div>
  );
}

import type * as React from "react";
import { cn } from "@/lib/utils";

export type DetailItem = [label: React.ReactNode, value: React.ReactNode];

/** Label/value pairs rendered as a semantic description list. */
export function DetailList({ items, className, columns = 2 }: { items: DetailItem[]; className?: string; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm", columns === 1 ? "" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map(([label, value], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-steel-600">{label}</dt>
          <dd className="mt-0.5 break-words text-steel-900">{value === null || value === undefined || value === "" ? "—" : value}</dd>
        </div>
      ))}
    </dl>
  );
}

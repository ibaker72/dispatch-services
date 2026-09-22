import type { LucideIcon } from "lucide-react";
import type * as React from "react";

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-steel-300 bg-white px-6 py-10 text-center">
      {Icon ? <Icon className="mb-3 size-8 text-steel-400" aria-hidden="true" /> : null}
      <h3 className="text-base font-semibold text-navy-900">{title}</h3>
      {children ? <div className="mt-1 max-w-md text-sm text-steel-600">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

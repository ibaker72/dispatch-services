import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { cls: "border-info/30 bg-info-soft text-info", Icon: Info },
  success: { cls: "border-success/30 bg-success-soft text-success", Icon: CheckCircle2 },
  warning: { cls: "border-warning/30 bg-warning-soft text-warning", Icon: AlertTriangle },
  danger: { cls: "border-danger/30 bg-danger-soft text-danger", Icon: XCircle },
} as const;

export function Alert({
  tone = "info",
  title,
  children,
  className,
  live,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  live?: boolean;
}) {
  const { cls, Icon } = TONES[tone];
  return (
    <div role={live ? (tone === "danger" ? "alert" : "status") : undefined} className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-steel-900">{children}</div> : null}
      </div>
    </div>
  );
}

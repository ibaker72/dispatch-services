import { cn } from "@/lib/utils";

export function BrandMark({ name, className, onDark = false }: { name: string; className?: string; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", onDark ? "text-paper" : "text-navy-900", className)}>
      <svg viewBox="0 0 64 64" className="size-7 shrink-0" aria-hidden="true">
        <rect width="64" height="64" rx="12" fill={onDark ? "#17304d" : "#0f1f33"} />
        <path d="M14 44 L30 20 L38 20 L22 44 Z" fill="#f2a900" />
        <path d="M30 44 L46 20 L50 20 L34 44 Z" fill="#faf8f5" />
      </svg>
      <span>{name}</span>
    </span>
  );
}

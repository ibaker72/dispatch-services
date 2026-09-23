import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { addDays, formatDate } from "@/lib/domain/dates";

export function WeekNav({ base, week, current, extra = "" }: { base: string; week: string; current: string; extra?: string }) {
  const cls = "inline-flex size-9 items-center justify-center rounded-md border border-steel-300 bg-white hover:bg-paper-2";
  return (
    <nav aria-label="Week" className="flex items-center gap-1 text-sm">
      <Link className={cls} href={`${base}?week=${addDays(week, -7)}${extra}`} aria-label="Previous week">
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Link>
      <span className="px-2 font-medium text-navy-900">
        {formatDate(week, { month: "short", day: "numeric" })} – {formatDate(addDays(week, 6))}
        {week === current ? " (this week)" : ""}
      </span>
      <Link className={cls} href={`${base}?week=${addDays(week, 7)}${extra}`} aria-label="Next week">
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </nav>
  );
}

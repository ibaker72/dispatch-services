import Link from "next/link";
import { cn } from "@/lib/utils";

/** Server-rendered tab navigation (each tab is a URL, so it works without JavaScript). */
export function TabNav({ tabs, current, label }: { tabs: Array<{ key: string; label: string; href: string; count?: number | null }>; current: string; label: string }) {
  return (
    <nav aria-label={label} className="mb-6 -mx-4 overflow-x-auto border-b border-steel-200 px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold",
                  active ? "border-navy-900 text-navy-900" : "border-transparent text-steel-600 hover:border-steel-300 hover:text-navy-900",
                )}
              >
                {t.label}
                {t.count ? <span className="rounded-full bg-steel-100 px-1.5 text-xs text-steel-700">{t.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

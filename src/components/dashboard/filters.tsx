import { Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Params = Record<string, string | undefined>;

export function hrefWith(base: string, params: Params, changes: Params): string {
  const merged = { ...params, ...changes };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/** Link-based tabs; the current tab is marked with aria-current for assistive tech. */
export function FilterTabs({
  base,
  params,
  name,
  options,
  label,
}: {
  base: string;
  params: Params;
  name: string;
  options: Array<{ value: string | undefined; label: string; count?: number | null }>;
  label: string;
}) {
  const current = params[name];
  return (
    <nav aria-label={label} className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
      {options.map((o) => {
        const active = (o.value ?? undefined) === (current ?? undefined);
        return (
          <Link
            key={o.label}
            href={hrefWith(base, params, { [name]: o.value, page: undefined })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium",
              active ? "border-navy-900 bg-navy-900 text-white" : "border-steel-300 bg-white text-navy-900 hover:bg-paper-2",
            )}
          >
            {o.label}
            {o.count ? <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-white/20" : "bg-steel-100")}>{o.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** GET search form that preserves the other filters. */
export function SearchForm({
  action,
  params,
  placeholder,
  selects = [],
}: {
  action: string;
  params: Params;
  placeholder: string;
  selects?: Array<{ name: string; label: string; options: Array<[value: string, label: string]> }>;
}) {
  const hidden = Object.entries(params).filter(([k, v]) => v && k !== "q" && k !== "page" && !selects.some((s) => s.name === k));
  return (
    <form action={action} method="get" role="search" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      {hidden.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="relative flex-1">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-steel-500" aria-hidden="true" />
        <Input type="search" name="q" defaultValue={params.q ?? ""} placeholder={placeholder} className="pl-9" />
      </label>
      {selects.map((s) => (
        <label key={s.name} className="sm:w-48">
          <span className="sr-only">{s.label}</span>
          <Select name={s.name} defaultValue={params[s.name] ?? ""}>
            <option value="">{s.label}: all</option>
            {s.options.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      ))}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

export function Pagination({ base, params, page, hasNext, total }: { base: string; params: Params; page: number; hasNext: boolean; total?: number | null }) {
  if (page === 1 && !hasNext) return total ? <p className="mt-3 text-sm text-steel-600">{total} total</p> : null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-steel-600">
        Page {page}
        {total ? ` · ${total} total` : ""}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className="rounded-md border border-steel-300 bg-white px-3 py-1.5 font-medium hover:bg-paper-2" href={hrefWith(base, params, { page: String(page - 1) })}>
            Previous
          </Link>
        ) : null}
        {hasNext ? (
          <Link className="rounded-md border border-steel-300 bg-white px-3 py-1.5 font-medium hover:bg-paper-2" href={hrefWith(base, params, { page: String(page + 1) })}>
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { JsonLd } from "@/components/json-ld";
import { TrackLink } from "@/components/track-link";
import { buttonVariants } from "@/components/ui/button";
import { type BusinessConfig, EQUIPMENT_LABELS, percentLabel } from "@/config/business";
import { EQUIPMENT_PAGES, type Faq, PROCESS_STEPS } from "@/content/marketing";
import { faqJsonLd } from "@/lib/seo";
import { cn } from "@/lib/utils";

export function Section({
  children,
  className,
  tone = "paper",
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "paper" | "white" | "tint" | "navy";
  labelledBy?: string;
}) {
  const bg = { paper: "bg-paper", white: "bg-white", tint: "bg-paper-2", navy: "on-dark bg-navy-900 text-steel-300" }[tone];
  return (
    <section aria-labelledby={labelledBy} className={cn("py-16 sm:py-20", bg, className)}>
      <div className="container-page">{children}</div>
    </section>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  intro,
  onDark = false,
  align = "left",
}: {
  id: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  onDark?: boolean;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("mb-10 max-w-3xl", align === "center" && "mx-auto text-center")}>
      {eyebrow ? <p className={cn("mb-2 text-sm font-semibold tracking-wide uppercase", onDark ? "text-accent" : "text-accent-ink")}>{eyebrow}</p> : null}
      <h2 id={id} className={cn("text-3xl font-semibold tracking-tight sm:text-4xl", onDark && "text-paper")}>
        {title}
      </h2>
      {intro ? <p className={cn("mt-3 text-lg", onDark ? "text-steel-300" : "text-steel-600")}>{intro}</p> : null}
    </div>
  );
}

export function PageHero({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="on-dark relative overflow-hidden bg-navy-900">
      <div aria-hidden="true" className="absolute inset-y-0 right-0 hidden w-1/3 bg-[repeating-linear-gradient(135deg,transparent_0_22px,rgba(242,169,0,0.07)_22px_26px)] md:block" />
      <div className="container-page relative py-16 sm:py-20">
        {eyebrow ? <p className="mb-3 text-sm font-semibold tracking-wide text-accent uppercase">{eyebrow}</p> : null}
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-paper sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg text-steel-300">{intro}</p>
        {children ? <div className="mt-8 flex flex-wrap gap-3">{children}</div> : null}
      </div>
    </section>
  );
}

export function PrimaryCtas({ location }: { location: string }) {
  return (
    <>
      <TrackLink href="/apply" cta="apply" location={location} className={buttonVariants({ variant: "accent", size: "lg" })}>
        Apply for Dispatch
      </TrackLink>
      <TrackLink href="/how-it-works" cta="how_it_works" location={location} className={buttonVariants({ variant: "outlineDark", size: "lg" })}>
        See How It Works
      </TrackLink>
    </>
  );
}

export function FeatureGrid({ items, columns = 3 }: { items: ReadonlyArray<{ title: string; body: string }>; columns?: 2 | 3 }) {
  return (
    <ul className={cn("grid gap-6 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
      {items.map((item) => (
        <li key={item.title} className="rounded-lg border border-steel-200 bg-white p-6">
          <h3 className="text-lg font-semibold">{item.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-steel-600">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function ProcessSteps({ onDark = false }: { onDark?: boolean }) {
  return (
    <ol className="grid gap-6 md:grid-cols-3">
      {PROCESS_STEPS.map((step, i) => (
        <li key={step.title} className={cn("rounded-lg p-6", onDark ? "bg-navy-800" : "border border-steel-200 bg-white")}>
          <span className={cn("inline-flex size-9 items-center justify-center rounded-full text-sm font-bold", onDark ? "bg-accent text-navy-900" : "bg-navy-900 text-white")}>
            {i + 1}
          </span>
          <h3 className={cn("mt-4 text-lg font-semibold", onDark && "text-paper")}>{step.title}</h3>
          <p className={cn("mt-2 text-[15px] leading-relaxed", onDark ? "text-steel-300" : "text-steel-600")}>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function EquipmentGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {EQUIPMENT_PAGES.map((page) => (
        <li key={page.key}>
          <Link href={page.path} className="group block h-full rounded-lg border border-steel-200 bg-white p-5 hover:border-navy-600">
            <p className="text-lg font-semibold text-navy-900 group-hover:underline">{EQUIPMENT_LABELS[page.key]}</p>
            <p className="mt-2 text-sm leading-relaxed text-steel-600">{page.checklist[0]}</p>
            {page.key === "car_hauler" ? <p className="mt-3 text-xs font-semibold text-accent-ink uppercase">Primary focus</p> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PricingCards({ profile, location }: { profile: BusinessConfig; location: string }) {
  const pct = percentLabel(profile.pricing.defaultPercentage);
  const flat = `$${Number(profile.pricing.flatWeeklyPerTruck).toFixed(0)}`;
  const plans = [
    {
      name: "Percentage of gross",
      price: pct,
      unit: "of eligible gross on completed loads",
      points: [
        "Pay only on loads that deliver and complete",
        "Detention, layover and TONU included by default; lumper reimbursements never are",
        "No charge in weeks without completed loads",
      ],
      featured: true,
    },
    {
      name: "Flat weekly",
      price: flat,
      unit: "per active truck, per week",
      points: ["Predictable cost for high-revenue trucks", "Same dispatch service and reporting", "Billed weekly for each active truck"],
      featured: false,
    },
  ];
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {plans.map((plan) => (
        <div key={plan.name} className={cn("flex flex-col rounded-lg border bg-white p-6", plan.featured ? "border-navy-900 ring-1 ring-navy-900" : "border-steel-200")}>
          <h3 className="text-lg font-semibold">{plan.name}</h3>
          <p className="mt-4">
            <span className="text-4xl font-semibold text-navy-900">{plan.price}</span>{" "}
            <span className="text-sm text-steel-600">{plan.unit}</span>
          </p>
          <ul className="mt-6 flex-1 space-y-3 text-[15px] text-steel-700">
            {plan.points.map((p) => (
              <li key={p} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <TrackLink href="/apply" cta={`apply_${plan.featured ? "percentage" : "flat"}`} location={location} className={cn(buttonVariants({ variant: plan.featured ? "primary" : "secondary", size: "lg" }), "mt-6")}>
            Apply for Dispatch
          </TrackLink>
        </div>
      ))}
    </div>
  );
}

/** Visible FAQ list with matching FAQPage structured data. */
export function FaqList({ faqs, id = "faq-heading", title = "Frequently asked questions" }: { faqs: Faq[]; id?: string; title?: string }) {
  return (
    <div>
      <h2 id={id} className="mb-6 text-3xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="divide-y divide-steel-200 rounded-lg border border-steel-200 bg-white">
        {faqs.map((faq) => (
          <details key={faq.q} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
              {faq.q}
              <ChevronDown className="size-5 shrink-0 text-steel-500 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <p className="mt-3 text-[15px] leading-relaxed text-steel-600">{faq.a}</p>
          </details>
        ))}
      </div>
      <JsonLd data={faqJsonLd(faqs)} />
    </div>
  );
}

export function CtaBand({ location, title = "Ready to talk about your truck?", body }: { location: string; title?: string; body?: string }) {
  return (
    <section aria-labelledby={`cta-${location}`} className="on-dark bg-navy-900">
      <div className="container-page flex flex-col items-start gap-6 py-14 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <h2 id={`cta-${location}`} className="text-2xl font-semibold text-paper sm:text-3xl">
            {title}
          </h2>
          <p className="mt-2 text-steel-300">
            {body ?? "Apply in about 10 minutes. We review every application personally and will tell you honestly whether we are a good fit for your equipment and lanes."}
          </p>
        </div>
        <TrackLink href="/apply" cta="apply" location={location} className={buttonVariants({ variant: "accent", size: "lg" })}>
          Apply for Dispatch
        </TrackLink>
      </div>
    </section>
  );
}

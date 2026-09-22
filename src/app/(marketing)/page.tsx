import { CheckCircle2, ShieldCheck } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import {
  CtaBand,
  EquipmentGrid,
  FaqList,
  FeatureGrid,
  PricingCards,
  PrimaryCtas,
  ProcessSteps,
  Section,
  SectionHeading,
} from "@/components/marketing/sections";
import { BENEFITS, HOME_FAQS, SERVICES } from "@/content/marketing";
import { organizationJsonLd, pageMetadata } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = pageMetadata({
  title: "Truck Dispatch for Owner-Operators and Small Carriers",
  description:
    "Dispatch for car haulers, hotshot, box truck and dry van carriers with their own authority. Rate negotiation, load planning and paperwork — you approve every load.",
  path: "/",
});

const PROMISES = [
  "You approve every load before it is booked",
  "Brokers pay you or your factor directly",
  "Transparent fee on every weekly statement",
];

export default async function HomePage() {
  const profile = await getBusinessProfile();
  return (
    <>
      <JsonLd data={organizationJsonLd(profile)} />
      <section className="on-dark relative overflow-hidden bg-navy-900">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 hidden w-2/5 bg-[repeating-linear-gradient(135deg,transparent_0_22px,rgba(242,169,0,0.07)_22px_26px)] lg:block"
        />
        <div className="container-page relative grid gap-12 py-16 sm:py-24 lg:grid-cols-[1.25fr_1fr] lg:items-center">
          <div>
            <p className="mb-4 text-sm font-semibold tracking-wide text-accent uppercase">Dispatch for owner-operators and small fleets</p>
            <h1 className="text-4xl font-semibold tracking-tight text-paper sm:text-5xl lg:text-[3.4rem] lg:leading-[1.1]">
              Better-planned loads. Your authority, your rules, your final say.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-steel-300">
              We find, negotiate and plan freight for carriers with their own authority — car haulers first, plus hotshot, box truck and
              dry van. You approve every load, get paid directly by brokers, and see exactly what you earned and what you owe us every
              week.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryCtas location="home_hero" />
            </div>
          </div>
          <div className="rounded-xl border border-navy-700 bg-navy-800 p-6">
            <p className="text-sm font-semibold text-paper">How we work with you</p>
            <ul className="mt-4 space-y-4">
              {PROMISES.map((p) => (
                <li key={p} className="flex gap-3 text-[15px] text-steel-300">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex gap-3 rounded-lg bg-navy-900 p-4 text-sm text-steel-300">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
              <p>
                We are a dispatch service, not a broker or carrier. We only work for carriers with active authority and insurance, and we
                are paid only by those carriers.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Section labelledBy="equipment-heading">
        <SectionHeading
          id="equipment-heading"
          eyebrow="Equipment"
          title="Built for car haulers, ready for your trailer"
          intro="Auto transport is our primary focus. We also dispatch hotshot, box truck and dry van carriers."
        />
        <EquipmentGrid />
      </Section>

      <Section tone="white" labelledBy="services-heading">
        <SectionHeading
          id="services-heading"
          eyebrow="What we do"
          title="The office work of running a truck, handled"
          intro="Your dispatcher works for you: searching, negotiating, planning and keeping paperwork in order so you can focus on driving."
        />
        <FeatureGrid items={SERVICES} />
      </Section>

      <Section tone="navy" labelledBy="process-heading">
        <SectionHeading id="process-heading" eyebrow="How it works" title="Three steps to your first load" onDark />
        <ProcessSteps onDark />
      </Section>

      <Section labelledBy="benefits-heading">
        <SectionHeading
          id="benefits-heading"
          eyebrow="Why it pays"
          title="Focused on the numbers that move your profit"
          intro="Revenue depends on the market, your equipment and your lanes, so we will not promise a weekly number. These are the levers we work on every day."
        />
        <FeatureGrid items={BENEFITS} columns={2} />
      </Section>

      <Section tone="tint" labelledBy="pricing-heading">
        <SectionHeading
          id="pricing-heading"
          eyebrow="Pricing"
          title="Two simple plans. No hidden fees."
          intro="Your fee terms are written in your agreement and shown on every weekly statement, separate from your gross revenue."
        />
        <PricingCards profile={profile} location="home_pricing" />
      </Section>

      <Section tone="white">
        <div className="max-w-3xl">
          <FaqList faqs={HOME_FAQS} />
        </div>
      </Section>

      <CtaBand location="home_final" />
    </>
  );
}

import { Check } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { CtaBand, FaqList, FeatureGrid, PrimaryCtas, ProcessSteps, PageHero, Section, SectionHeading } from "@/components/marketing/sections";
import { type EquipmentPage } from "@/content/marketing";
import { serviceJsonLd } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export async function EquipmentLanding({ page }: { page: EquipmentPage }) {
  const profile = await getBusinessProfile();
  return (
    <>
      <JsonLd
        data={serviceJsonLd(profile, {
          name: page.title,
          description: page.metaDescription,
          path: page.path,
          audience: "Owner-operators and small motor carriers with their own operating authority",
        })}
      />
      <PageHero eyebrow={page.title} title={page.heading} intro={page.intro}>
        <PrimaryCtas location={`${page.key}_hero`} />
      </PageHero>
      <Section labelledBy="focus-heading">
        <SectionHeading id="focus-heading" eyebrow="What we focus on" title={`Where a dispatcher adds value for ${page.title.replace(" dispatch", "").toLowerCase()} carriers`} />
        <FeatureGrid items={page.focus} />
      </Section>
      <Section tone="white" labelledBy="fit-heading">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading id="fit-heading" eyebrow="Good fit" title="Who we dispatch for" />
            <ul className="space-y-3 text-[15px] text-steel-700">
              {page.checklist.map((item) => (
                <li key={item} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                <span>Your own active MC/USDOT authority and insurance (we do not lease you onto ours)</span>
              </li>
            </ul>
          </div>
          <div className="rounded-lg border border-steel-200 bg-paper p-6">
            <h3 className="text-lg font-semibold">Serving carriers across the United States</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-steel-600">
              We dispatch nationwide and plan around the states and lanes you choose. Tell us your home base, preferred states and any states
              to avoid in the application — your dispatcher works inside those limits.
            </p>
          </div>
        </div>
      </Section>
      <Section tone="navy" labelledBy="steps-heading">
        <SectionHeading id="steps-heading" title="Getting started" onDark />
        <ProcessSteps onDark />
      </Section>
      <Section>
        <div className="max-w-3xl">
          <FaqList faqs={page.faqs} title={`${page.title} questions`} />
        </div>
      </Section>
      <CtaBand location={`${page.key}_final`} />
    </>
  );
}

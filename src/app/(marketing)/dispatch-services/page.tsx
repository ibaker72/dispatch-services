import { JsonLd } from "@/components/json-ld";
import { CtaBand, EquipmentGrid, FeatureGrid, PageHero, PrimaryCtas, Section, SectionHeading } from "@/components/marketing/sections";
import { SERVICES } from "@/content/marketing";
import { pageMetadata, serviceJsonLd } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = pageMetadata({
  title: "Truck Dispatch Services",
  description:
    "What our dispatchers do for carriers with their own authority: load search, rate negotiation, planning, broker setup, check calls, paperwork and weekly reporting.",
  path: "/dispatch-services",
});

const NOT_DONE = [
  "Arrange freight for shippers or act as a freight broker",
  "Accept or book a load without your approval",
  "Collect, hold or pass through freight payments",
  "Take money from brokers, shippers or factoring companies",
  "Reassign your loads to another carrier",
];

export default async function DispatchServicesPage() {
  const profile = await getBusinessProfile();
  return (
    <>
      <JsonLd
        data={serviceJsonLd(profile, {
          name: "Truck dispatch services",
          description: "Dispatch services performed on behalf of motor carriers with their own operating authority.",
          path: "/dispatch-services",
          audience: "Owner-operators and small motor carriers",
        })}
      />
      <PageHero
        eyebrow="Dispatch services"
        title="A dispatcher who works for your truck, not for the broker"
        intro="We act as your office: we search, negotiate and plan within the rules you set, then handle the calls and paperwork after you approve a load."
      >
        <PrimaryCtas location="services_hero" />
      </PageHero>
      <Section labelledBy="services-heading">
        <SectionHeading id="services-heading" title="What is included" />
        <FeatureGrid items={SERVICES} />
      </Section>
      <Section tone="white" labelledBy="limits-heading">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              id="limits-heading"
              eyebrow="Clear boundaries"
              title="What we do not do"
              intro="A dispatch service works on behalf of the carrier. Keeping these lines clear protects you and keeps the relationship simple."
            />
          </div>
          <ul className="space-y-3 self-center rounded-lg border border-steel-200 bg-paper p-6 text-[15px] text-steel-700">
            {NOT_DONE.map((item) => (
              <li key={item} className="flex gap-3">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-ink" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>
      <Section labelledBy="equipment-heading">
        <SectionHeading id="equipment-heading" title="Equipment we dispatch" />
        <EquipmentGrid />
      </Section>
      <CtaBand location="services_final" />
    </>
  );
}

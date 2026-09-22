import { JsonLd } from "@/components/json-ld";
import { CtaBand, PageHero, Section, SectionHeading } from "@/components/marketing/sections";
import { relationshipDisclosure } from "@/content/marketing";
import { organizationJsonLd, pageMetadata } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = pageMetadata({
  title: "About Us",
  description: "A dispatch service built around carrier control, honest numbers and organized paperwork for owner-operators and small fleets.",
  path: "/about",
});

const PRINCIPLES = [
  { title: "The carrier decides", body: "We propose; you approve. We record every approval so there is never a question about who agreed to what." },
  { title: "Honest numbers", body: "We show rate per mile, deadhead and our fee on every proposal and statement. We do not promise income we cannot control." },
  { title: "One client per load", body: "We work for the carrier. We are not paid by brokers, shippers or factoring companies, so our incentives stay aligned with yours." },
  { title: "Organized by default", body: "Documents, approvals, status changes and invoices are tracked in one place and available to you in your portal." },
];

export default async function AboutPage() {
  const profile = await getBusinessProfile();
  return (
    <>
      <JsonLd data={organizationJsonLd(profile)} />
      <PageHero
        eyebrow="About"
        title={`${profile.brandName} is a dispatch office for independent carriers`}
        intro="We started with car haulers because multi-vehicle loads reward careful planning, and we built our tools so every carrier can see exactly what we do on their behalf."
      />
      <Section labelledBy="principles-heading">
        <SectionHeading id="principles-heading" eyebrow="How we operate" title="Principles we hold ourselves to" />
        <ul className="grid gap-6 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <li key={p.title} className="rounded-lg border border-steel-200 bg-white p-6">
              <h3 className="text-lg font-semibold">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-steel-600">{p.body}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section tone="white" labelledBy="relationship-heading">
        <div className="max-w-3xl">
          <h2 id="relationship-heading" className="text-2xl font-semibold">
            Our role
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-steel-600">{relationshipDisclosure(profile.brandName)}</p>
        </div>
      </Section>
      <CtaBand location="about_final" />
    </>
  );
}

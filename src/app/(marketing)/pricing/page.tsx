import { CtaBand, FaqList, PageHero, PricingCards, Section, SectionHeading } from "@/components/marketing/sections";
import { percentLabel } from "@/config/business";
import { PRICING_FAQS } from "@/content/marketing";
import { calculateLoadFee } from "@/lib/domain/fees";
import { formatCents } from "@/lib/domain/money";
import { pageMetadata } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = pageMetadata({
  title: "Dispatch Pricing",
  description: "Transparent truck dispatch pricing: a percentage of gross on completed loads or a flat weekly fee per truck. Paid by the carrier only.",
  path: "/pricing",
});

export default async function PricingPage() {
  const profile = await getBusinessProfile();
  const pct = percentLabel(profile.pricing.defaultPercentage);
  const example = calculateLoadFee(
    { grossRate: "2500.00", detention: "150.00" },
    {
      model: "percentage",
      percentage: profile.pricing.defaultPercentage,
      flatWeeklyAmount: null,
      includeDetention: true,
      includeLayover: true,
      includeTonu: true,
      includeOther: false,
    },
  );
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Simple, written fee terms"
        intro="Choose a percentage of gross on completed loads or a flat weekly fee per truck. Your terms are recorded in your agreement and applied the same way every week."
      />
      <Section labelledBy="plans-heading">
        <h2 id="plans-heading" className="sr-only">
          Plans
        </h2>
        <PricingCards profile={profile} location="pricing" />
      </Section>
      <Section tone="white" labelledBy="example-heading">
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionHeading
            id="example-heading"
            eyebrow="Worked example"
            title="How the percentage fee is calculated"
            intro="An illustration of the math only — not a prediction of what any load will pay."
          />
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 self-center rounded-lg border border-steel-200 bg-paper p-6 text-[15px]">
            <dt className="text-steel-600">Line-haul rate</dt>
            <dd className="text-right font-semibold tabular-nums">{formatCents(example.gross)}</dd>
            <dt className="text-steel-600">Detention (included by default)</dt>
            <dd className="text-right font-semibold tabular-nums">{formatCents(example.accessorials)}</dd>
            <dt className="text-steel-600">Eligible revenue</dt>
            <dd className="text-right font-semibold tabular-nums">{formatCents(example.eligibleRevenue)}</dd>
            <dt className="border-t border-steel-200 pt-3 font-semibold text-navy-900">Dispatch fee at {pct}</dt>
            <dd className="border-t border-steel-200 pt-3 text-right font-semibold text-navy-900 tabular-nums">{formatCents(example.dispatchFee)}</dd>
          </dl>
        </div>
      </Section>
      <Section>
        <div className="max-w-3xl">
          <FaqList faqs={PRICING_FAQS} title="Pricing questions" />
        </div>
      </Section>
      <CtaBand location="pricing_final" />
    </>
  );
}

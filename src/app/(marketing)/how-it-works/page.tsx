import { CtaBand, PageHero, PrimaryCtas, ProcessSteps, Section, SectionHeading } from "@/components/marketing/sections";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "How Our Dispatch Service Works",
  description: "From application to your first booked load: verification, agreement, setup, proposals you approve, paperwork and weekly statements.",
  path: "/how-it-works",
});

const WEEK = [
  { title: "Set your rules", body: "Minimum rate per mile, preferred and avoided states, days available and maximum deadhead live in your portal. Update them any time." },
  { title: "Review proposals", body: "Your dispatcher sends loads that fit. Each shows lane, pickup and delivery windows, rate, loaded and deadhead miles, rate per mile and the estimated fee." },
  { title: "Approve or reject", body: "Approve in the portal (or tell your dispatcher directly; they record it). Rejections go back to the broker — loads are never passed to another carrier." },
  { title: "We book and track", body: "We confirm the rate confirmation, handle check calls and appointments, and chase detention and TONU when they apply." },
  { title: "Upload paperwork", body: "Snap the BOL and POD; we organize them with the rate confirmation so you or your factor can bill quickly." },
  { title: "Weekly statement", body: "Every week you see completed loads, your gross revenue, eligible revenue and the dispatch fee, then pay online or by check/ACH." },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="Clear steps, and you approve every load"
        intro="Onboarding takes a few days once your documents are in. After that, the weekly rhythm is simple and you stay in control of every booking."
      >
        <PrimaryCtas location="how_hero" />
      </PageHero>
      <Section labelledBy="start-heading">
        <SectionHeading id="start-heading" eyebrow="Getting started" title="From application to your first load" />
        <ProcessSteps />
        <div className="mt-8 rounded-lg border border-steel-200 bg-white p-6 text-[15px] leading-relaxed text-steel-600">
          <h3 className="text-base font-semibold text-navy-900">What onboarding covers</h3>
          <p className="mt-2">
            Authority and insurance verification, your W-9 and certificate of insurance, the dispatch service agreement, a broker and load-board
            authorization acknowledgment, factoring details (if you factor), your trucks and drivers, and an assigned dispatcher. Your account is
            activated when every item is complete.
          </p>
        </div>
      </Section>
      <Section tone="white" labelledBy="week-heading">
        <SectionHeading id="week-heading" eyebrow="Every week" title="What a normal week looks like" />
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {WEEK.map((item, i) => (
            <li key={item.title} className="rounded-lg border border-steel-200 bg-paper p-6">
              <p className="text-sm font-semibold text-accent-ink">Step {i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-steel-600">{item.body}</p>
            </li>
          ))}
        </ol>
      </Section>
      <CtaBand location="how_final" />
    </>
  );
}

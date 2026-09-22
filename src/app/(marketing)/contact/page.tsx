import { ContactForm } from "./contact-form";
import { PageHero, Section } from "@/components/marketing/sections";
import { isPlaceholder } from "@/config/business";
import { pageMetadata } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = pageMetadata({
  title: "Contact",
  description: "Questions about dispatch for your carrier? Send a message or call. We work only with motor carriers that have their own authority.",
  path: "/contact",
});

export default async function ContactPage() {
  const profile = await getBusinessProfile();
  return (
    <>
      <PageHero eyebrow="Contact" title="Talk to a dispatcher" intro="Questions about how we would work with your truck, pricing or onboarding — we are glad to help." />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-lg border border-steel-200 bg-white p-6 sm:p-8">
            <h2 className="mb-6 text-xl font-semibold">Send a message</h2>
            <ContactForm />
          </div>
          <aside className="space-y-6 text-[15px] text-steel-700">
            <div>
              <h2 className="text-lg font-semibold">Reach us directly</h2>
              <dl className="mt-3 space-y-2">
                <div>
                  <dt className="text-sm text-steel-600">Phone</dt>
                  <dd>{isPlaceholder(profile.phone) ? profile.phone : <a className="font-medium text-navy-700 underline" href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}>{profile.phone}</a>}</dd>
                </div>
                <div>
                  <dt className="text-sm text-steel-600">Email</dt>
                  <dd>{isPlaceholder(profile.email) ? profile.email : <a className="font-medium text-navy-700 underline" href={`mailto:${profile.email}`}>{profile.email}</a>}</dd>
                </div>
                <div>
                  <dt className="text-sm text-steel-600">Office</dt>
                  <dd>{profile.address}</dd>
                </div>
              </dl>
            </div>
            <div className="rounded-lg border border-steel-200 bg-paper-2 p-5">
              <h2 className="text-base font-semibold">Shippers and brokers</h2>
              <p className="mt-2 text-sm leading-relaxed text-steel-600">
                We work only on behalf of motor carriers and do not arrange transportation for shippers. If you have freight to move, please
                contact a licensed freight broker or carrier directly.
              </p>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}

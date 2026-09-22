import { WaitlistForm } from "./waitlist-form";
import { PageHero, Section } from "@/components/marketing/sections";
import { Alert } from "@/components/ui/alert";
import { business } from "@/config/business";
import { pageMetadata } from "@/lib/seo";
import { getBusinessProfile, getFeatureFlag } from "@/lib/settings";

export const metadata = pageMetadata({
  title: "Lease-On Waitlist",
  description: "Interested in a future lease-on program for drivers without their own authority? Join the waitlist. The program is not available today.",
  path: "/lease-on-waitlist",
});

export default async function LeaseOnWaitlistPage() {
  const profile = await getBusinessProfile();
  const open = business.leaseOn.waitlistEnabled && (await getFeatureFlag("lease_on_waitlist"));
  return (
    <>
      <PageHero
        eyebrow="Lease-on waitlist"
        title="Interested in leasing on? Join the waitlist."
        intro="Some drivers want to run their own truck without holding their own authority. We are considering a lease-on program in the future. It is not available today."
      />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-4 text-[15px] leading-relaxed text-steel-700">
            <h2 className="text-xl font-semibold">What this means today</h2>
            <p>
              {profile.brandName} currently provides dispatch services only. We do not hold operating authority, we do not lease owner-operators
              onto an authority, and we cannot dispatch drivers who do not have their own MC/USDOT authority and insurance.
            </p>
            <p>
              A lease-on program would require the company to hold its own authority and insurance, complete federal and state filings, and put
              attorney-approved lease agreements in place. We will not launch one until all of that is done.
            </p>
            <p>If you already have your own authority, you can apply for dispatch today.</p>
          </div>
          <div className="rounded-lg border border-steel-200 bg-white p-6 sm:p-8">
            {open ? (
              <WaitlistForm />
            ) : (
              <Alert tone="info" title="The waitlist is closed">
                Please check back later.
              </Alert>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

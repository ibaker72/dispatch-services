import { LegalPage } from "@/components/marketing/legal-page";
import { displayableAuthority } from "@/config/business";
import { pageMetadata } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = pageMetadata({
  title: "Dispatch Relationship Disclosure",
  description: "What our dispatch service is and is not: we work on behalf of carriers, are paid only by carriers, and are not a broker or motor carrier.",
  path: "/dispatch-disclosure",
});

export default async function DisclosurePage() {
  const p = await getBusinessProfile();
  const authority = displayableAuthority(p);
  return (
    <LegalPage title="Dispatch Relationship Disclosure" updated="September 22, 2026">
      <h2>Who we work for</h2>
      <p>
        {p.brandName} provides truck dispatch services to motor carriers under a written agreement with each carrier. We act on behalf of the
        carrier and within the carrier&rsquo;s instructions. The carrier is our only client for every load we dispatch.
      </p>
      <h2>What we are not</h2>
      <ul>
        <li>We are not a freight broker. We do not arrange transportation for shippers, do not solicit freight from shippers and do not contract with shippers.</li>
        <li>We are not a motor carrier and do not transport freight. {authority ? `Our company authority is USDOT ${authority.usdot} / MC ${authority.mc}; dispatch services are provided separately under each carrier's own authority.` : "We do not currently hold operating authority."}</li>
        <li>We do not describe ourselves as a &ldquo;licensed dispatcher&rdquo;. The Federal Motor Carrier Safety Administration does not issue licenses for dispatch services.</li>
      </ul>
      <h2>How loads are handled</h2>
      <ul>
        <li>Every load we work is associated with a specific contracted carrier before we negotiate it.</li>
        <li>The carrier approves or rejects every proposed load. We record the approval, the time and the person who approved it.</li>
        <li>Loads are never reassigned from one carrier to another. If a load cannot be completed by the carrier, it is returned to the broker.</li>
      </ul>
      <h2>How money flows</h2>
      <ul>
        <li>Brokers pay carriers, or the carrier&rsquo;s factoring company, directly. We never collect, hold or pass through freight payments.</li>
        <li>The carrier pays our dispatch fee under the terms in its agreement.</li>
        <li>We do not accept compensation, referral fees or rebates from brokers, shippers or factoring companies.</li>
      </ul>
      <h2>Carrier responsibilities</h2>
      <p>
        The carrier remains responsible for its authority, insurance, safety and regulatory compliance, drivers, equipment and the performance of
        each load.
      </p>
      <h2>Questions</h2>
      <p>
        Contact {p.legalEntity} at {p.email} or {p.phone}.
      </p>
    </LegalPage>
  );
}

import { LegalPage } from "@/components/marketing/legal-page";
import { pageMetadata } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = pageMetadata({ title: "Privacy Policy", description: "How we collect, use, share and protect information.", path: "/privacy" });

export default async function PrivacyPage() {
  const p = await getBusinessProfile();
  return (
    <LegalPage title="Privacy Policy" updated="September 22, 2026">
      <p>
        This policy explains how {p.legalEntity} (&ldquo;{p.brandName}&rdquo;, &ldquo;we&rdquo;) handles information collected through this
        website, the carrier application, the carrier portal and our dispatch services.
      </p>
      <h2>Information we collect</h2>
      <ul>
        <li>Contact details you provide: name, email, phone number and business address.</li>
        <li>Business and authority information: legal and DBA names, MC and USDOT numbers, years in business, authority dates and only the last four digits of your EIN. We do not ask for Social Security numbers or bank login credentials.</li>
        <li>Operating information: equipment, drivers and their contact details, lanes, availability, rate preferences and factoring company.</li>
        <li>Documents you upload, such as W-9s, certificates of insurance, authority letters, rate confirmations, bills of lading and proofs of delivery.</li>
        <li>Load, statement, invoice and payment records related to our services. Card and bank payments are processed by Stripe; we do not store full card or account numbers.</li>
        <li>Technical data: security logs, and privacy-limited product analytics that exclude names, contact details, MC/DOT numbers, VINs, document names and financial amounts.</li>
      </ul>
      <h2>How we use information</h2>
      <ul>
        <li>To evaluate applications, verify authority and insurance, and onboard carriers.</li>
        <li>To perform dispatch services on your behalf, including sharing carrier setup information with brokers you authorize us to work with.</li>
        <li>To bill for our services and send transactional emails.</li>
        <li>To secure the platform, prevent abuse and meet legal obligations.</li>
      </ul>
      <h2>How information is shared</h2>
      <p>
        We share information with brokers and load boards only as needed to find and book loads you approve, and with service providers that
        host or support the platform (for example database hosting, email delivery, payment processing, error monitoring and analytics) under
        contracts that limit their use of the data. We do not sell personal information.
      </p>
      <h2>Retention</h2>
      <p>
        We keep agreement, financial and audit records for as long as required for legal, tax and dispute purposes, and other records while your
        account is active and for a reasonable period afterward.
      </p>
      <h2>Security</h2>
      <p>
        Documents are stored in private storage and shared through short-lived links. Access is restricted by role, and each carrier can see
        only its own records.
      </p>
      <h2>Your choices</h2>
      <p>
        You may request access to, correction of, or deletion of your information, subject to records we must retain. Contact us at {p.email}.
      </p>
      <h2>Contact</h2>
      <p>
        {p.legalEntity}, {p.address}. Email {p.email} or call {p.phone}.
      </p>
    </LegalPage>
  );
}

import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { pageMetadata } from "@/lib/seo";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = pageMetadata({ title: "Terms of Service", description: "Terms for using this website and the carrier portal.", path: "/terms" });

export default async function TermsPage() {
  const p = await getBusinessProfile();
  return (
    <LegalPage title="Terms of Service" updated="September 22, 2026">
      <p>
        These terms govern use of this website and the carrier portal operated by {p.legalEntity} (&ldquo;{p.brandName}&rdquo;). Dispatch
        services themselves are governed by the signed dispatch service agreement between {p.brandName} and each carrier; if these terms conflict
        with that agreement, the agreement controls.
      </p>
      <h2>Who may use the portal</h2>
      <p>
        The carrier portal is for motor carriers that have their own active operating authority and insurance and have an agreement with us, and
        for people those carriers authorize. You are responsible for keeping your login secure and for actions taken under your account.
      </p>
      <h2>Our role</h2>
      <p>
        We provide dispatch services on behalf of carriers. We are not a motor carrier or freight broker. See the{" "}
        <Link href="/dispatch-disclosure">Dispatch Relationship Disclosure</Link>.
      </p>
      <h2>No guarantees</h2>
      <p>
        We do not guarantee any volume of loads, rates, revenue or income. Examples on this website illustrate how fees are calculated and are
        not predictions.
      </p>
      <h2>Acceptable use</h2>
      <p>
        Do not upload unlawful content or malware, attempt to access other carriers&rsquo; information, interfere with the service, or use it to
        solicit freight on behalf of shippers.
      </p>
      <h2>Fees and payment</h2>
      <p>
        Fees are set in your agreement and shown on weekly statements. Online payments are processed by Stripe. Freight charges are paid by
        brokers directly to carriers or their factoring companies and never pass through us.
      </p>
      <h2>Ending service</h2>
      <p>Either party may end the service as described in the dispatch service agreement.</p>
      <h2>Limitation of liability</h2>
      <p>To the extent permitted by law, our liability related to the website and portal is limited as set out in the dispatch service agreement.</p>
      <h2>Contact</h2>
      <p>
        {p.legalEntity}, {p.address} · {p.email} · {p.phone}
      </p>
    </LegalPage>
  );
}

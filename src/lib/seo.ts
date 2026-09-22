import type { Metadata } from "next";
import { type BusinessConfig, isPlaceholder } from "@/config/business";
import { absoluteUrl, siteUrl } from "@/lib/site-url";

export function pageMetadata({
  title,
  description,
  path,
  noIndex = false,
}: {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      type: "website",
      locale: "en_US",
    },
    twitter: { card: "summary_large_image", title, description },
    robots: noIndex ? { index: false, follow: false } : undefined,
  };
}

/** Organization structured data. Only real contact details are included. */
export function organizationJsonLd(profile: BusinessConfig) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: profile.brandName,
    url: siteUrl(),
    description: "Truck dispatch services for owner-operators and small motor carriers with their own operating authority.",
    areaServed: { "@type": "Country", name: "United States" },
  };
  if (!isPlaceholder(profile.legalEntity)) data.legalName = profile.legalEntity;
  if (!isPlaceholder(profile.email)) data.email = profile.email;
  if (!isPlaceholder(profile.phone)) data.telephone = profile.phone;
  return data;
}

export function serviceJsonLd(profile: BusinessConfig, service: { name: string; description: string; path: string; audience: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.name,
    serviceType: "Truck dispatch service",
    description: service.description,
    url: absoluteUrl(service.path),
    provider: { "@type": "Organization", name: profile.brandName, url: siteUrl() },
    areaServed: { "@type": "Country", name: "United States" },
    audience: { "@type": "BusinessAudience", audienceType: service.audience },
  };
}

/** FAQPage schema — only used on pages that render the same questions visibly. */
export function faqJsonLd(faqs: Array<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

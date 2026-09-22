import { business, isPlaceholder } from "@/config/business";

/** Absolute origin of the site, used for canonical URLs, sitemaps and emails. */
export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (!isPlaceholder(business.websiteUrl)) return business.websiteUrl.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

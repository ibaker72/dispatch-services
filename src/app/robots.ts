import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const production = process.env.APP_ENV === "production";
  return {
    rules: production
      ? [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/portal", "/api/", "/auth/", "/invite", "/apply/resume", "/mfa", "/reset-password", "/verify-email", "/dev/"] }]
      : [{ userAgent: "*", disallow: "/" }],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl(),
  };
}

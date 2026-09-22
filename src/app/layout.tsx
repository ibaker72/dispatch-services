import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type * as React from "react";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { getBusinessProfile } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getBusinessProfile();
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${profile.brandName} — Truck dispatch for owner-operators and small carriers`,
      template: `%s | ${profile.brandName}`,
    },
    description:
      "Truck dispatch for owner-operators and small carriers with their own authority: rate negotiation, load planning, broker paperwork and weekly reporting. You approve every load.",
    applicationName: profile.brandName,
    openGraph: { siteName: profile.brandName, type: "website", locale: "en_US" },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0f1f33",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers opts every page into dynamic rendering, which the
  // nonce-based Content Security Policy requires.
  await headers();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-navy-900 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to main content
        </a>
        {children}
        <AnalyticsProvider />
      </body>
    </html>
  );
}

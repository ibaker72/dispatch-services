import type * as React from "react";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getBusinessProfile } from "@/lib/settings";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const profile = await getBusinessProfile();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader brandName={profile.brandName} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter profile={profile} />
    </div>
  );
}

import Link from "next/link";
import type * as React from "react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { getBusinessProfile } from "@/lib/settings";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const profile = await getBusinessProfile();
  return (
    <div className="flex min-h-dvh flex-col bg-paper-2">
      <header className="container-page flex h-16 items-center">
        <Link href="/" aria-label={`${profile.brandName} home`}>
          <BrandMark name={profile.brandName} />
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12">
        <div className="w-full max-w-md rounded-xl border border-steel-200 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">{children}</div>
      </main>
    </div>
  );
}

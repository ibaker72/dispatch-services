import Link from "next/link";
import type * as React from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import type { NavItem } from "@/components/app-shell/nav-links";
import { requireCarrierUser } from "@/lib/auth/session";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = { robots: { index: false, follow: false } };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCarrierUser();
  const profile = await getBusinessProfile();
  const owner = ctx.membership.role === "carrier_owner";
  const { count: awaiting } = await ctx.supabase.from("loads").select("id", { count: "exact", head: true }).eq("status", "proposed");
  const onboarding = ctx.membership.carrierStatus !== "active";

  const nav: NavItem[] = [
    { href: "/portal", label: "Overview", icon: "gauge", exact: true },
    ...(onboarding ? [{ href: "/portal/onboarding", label: "Onboarding", icon: "handshake" as const }] : []),
    { href: "/portal/loads", label: "Loads", icon: "route", badge: awaiting ?? 0 },
    { href: "/portal/fleet", label: "Trucks & availability", icon: "truck" },
    { href: "/portal/preferences", label: "Lanes & rates", icon: "calendar" },
    { href: "/portal/documents", label: "Documents", icon: "file" },
    { href: "/portal/performance", label: "Performance", icon: "chart" },
    { href: "/portal/billing", label: "Statements & invoices", icon: "wallet" },
    ...(owner ? [{ href: "/portal/team", label: "Team", icon: "team" as const }] : []),
    { href: "/portal/support", label: "Support", icon: "support" },
    { href: "/portal/account", label: "Account", icon: "settings" },
  ];

  const banner = onboarding ? (
    <div role="note" className="border-b border-info/30 bg-info-soft px-4 py-2 text-sm text-info sm:px-6">
      Your account is in onboarding. Dispatch starts after every onboarding step is complete.{" "}
      <Link href="/portal/onboarding" className="font-semibold underline">
        Continue onboarding
      </Link>
    </div>
  ) : null;

  return (
    <AppShell
      area={ctx.membership.carrierName ?? "Carrier portal"}
      brandName={profile.brandName}
      homeHref="/portal"
      nav={nav}
      banner={banner}
      user={{ name: ctx.profile?.full_name ?? ctx.email, email: ctx.email, roleLabel: owner ? "Owner" : "Team member" }}
    >
      {children}
    </AppShell>
  );
}

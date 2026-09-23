import Link from "next/link";
import type * as React from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import type { NavItem } from "@/components/app-shell/nav-links";
import { placeholderFields } from "@/config/business";
import { isAdminRole, requireStaff } from "@/lib/auth/session";
import { getBusinessProfile } from "@/lib/settings";

export const metadata = { robots: { index: false, follow: false } };

const ROLE_LABELS = { super_admin: "Super admin", admin: "Admin", dispatcher: "Dispatcher" } as const;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const profile = await getBusinessProfile();
  const admin = isAdminRole(ctx.staffRoles);
  const { count: pendingApps } = await ctx.supabase
    .from("carrier_applications")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "under_review"]);

  const nav: NavItem[] = [
    { href: "/dashboard", label: "Overview", icon: "gauge", exact: true },
    { href: "/dashboard/applications", label: "Applications", icon: "inbox", badge: pendingApps ?? 0 },
    { href: "/dashboard/carriers", label: "Carriers", icon: "building" },
    ...(admin ? [{ href: "/dashboard/assignments", label: "Dispatcher assignments", icon: "team" as const }] : []),
    { href: "/dashboard/fleet", label: "Trucks & drivers", icon: "truck" },
    { href: "/dashboard/loads", label: "Loads", icon: "route" },
    { href: "/dashboard/documents", label: "Documents", icon: "file" },
    { href: "/dashboard/tasks", label: "Tasks", icon: "tasks" },
    { href: "/dashboard/performance", label: "Performance", icon: "chart" },
    { href: "/dashboard/billing", label: "Billing", icon: "wallet" },
    { href: "/dashboard/communications", label: "Communications", icon: "message" },
    { href: "/dashboard/support", label: "Support requests", icon: "support" },
    ...(admin
      ? [
          { href: "/dashboard/audit", label: "Audit log", icon: "audit" as const },
          { href: "/dashboard/waitlist", label: "Lease-on waitlist", icon: "waitlist" as const },
          { href: "/dashboard/settings", label: "Settings", icon: "settings" as const },
        ]
      : []),
  ];

  const placeholders = admin ? placeholderFields(profile) : [];
  const role = ctx.staffRoles.includes("super_admin") ? "super_admin" : ctx.staffRoles.includes("admin") ? "admin" : "dispatcher";
  const banner = (
    <>
      {placeholders.length ? (
        <div role="note" className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning sm:px-6">
          Business details still contain placeholders ({placeholders.join(", ")}).{" "}
          <Link href="/dashboard/settings" className="font-semibold underline">
            Update settings
          </Link>
        </div>
      ) : null}
      {admin && !ctx.hasVerifiedMfaFactor ? (
        <div role="note" className="border-b border-info/30 bg-info-soft px-4 py-2 text-sm text-info sm:px-6">
          Protect this administrative account with two-step verification.{" "}
          <Link href="/mfa?next=/dashboard" className="font-semibold underline">
            Set up MFA
          </Link>
        </div>
      ) : null}
    </>
  );

  return (
    <AppShell
      area="Dispatch dashboard"
      brandName={profile.brandName}
      homeHref="/dashboard"
      nav={nav}
      banner={banner}
      user={{ name: ctx.profile?.full_name ?? ctx.email, email: ctx.email, roleLabel: ROLE_LABELS[role] }}
    >
      {children}
    </AppShell>
  );
}

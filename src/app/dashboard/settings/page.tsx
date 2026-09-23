import { AgreementsSection } from "./_sections/agreements";
import { ApplicationSection, EquipmentSection, PricingSection } from "./_sections/catalog";
import { BusinessSection, EmailSection, OperationsSection } from "./_sections/general";
import { JobsSection } from "./_sections/jobs";
import { FlagsSection, SecuritySection } from "./_sections/security";
import { TabNav } from "@/components/dashboard/tab-nav";
import { PageHeader } from "@/components/ui/page-header";
import { isElevated, requireStaff } from "@/lib/auth/session";
import { type RawSearchParams, flatParams, oneOf } from "@/lib/db/query";
import { getOperationsSettings } from "@/lib/settings";

export const metadata = { title: "Settings" };

const TABS = ["business", "operations", "pricing", "application", "equipment", "agreements", "emails", "flags", "security", "jobs"] as const;
const LABELS: Record<(typeof TABS)[number], string> = {
  business: "Business profile",
  operations: "Operations & schedules",
  pricing: "Pricing",
  application: "Application & documents",
  equipment: "Equipment",
  agreements: "Agreements",
  emails: "Email templates",
  flags: "Feature flags & lease-on",
  security: "Security & staff",
  jobs: "Scheduled jobs",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff({ admin: true, nextPath: "/dashboard/settings" });
  const tab = oneOf(flatParams(await searchParams).tab, TABS) ?? "business";
  const elevated = isElevated(ctx);
  const superAdmin = ctx.staffRoles.includes("super_admin");

  return (
    <>
      <PageHeader title="Settings" description="Changes are recorded in the audit log. Security-sensitive settings require a verified super administrator." />
      <TabNav label="Settings sections" current={tab} tabs={TABS.map((t) => ({ key: t, label: LABELS[t], href: t === "business" ? "/dashboard/settings" : `/dashboard/settings?tab=${t}` }))} />
      {tab === "business" ? <BusinessSection /> : null}
      {tab === "operations" ? <OperationsSection /> : null}
      {tab === "pricing" ? <PricingSection supabase={ctx.supabase} /> : null}
      {tab === "application" ? <ApplicationSection supabase={ctx.supabase} /> : null}
      {tab === "equipment" ? <EquipmentSection supabase={ctx.supabase} /> : null}
      {tab === "agreements" ? <AgreementsSection supabase={ctx.supabase} elevated={elevated} superAdmin={superAdmin} /> : null}
      {tab === "emails" ? <EmailSection /> : null}
      {tab === "flags" ? <FlagsSection supabase={ctx.supabase} elevated={elevated} /> : null}
      {tab === "jobs" ? <JobsSection supabase={ctx.supabase} timezone={(await getOperationsSettings()).timezone} /> : null}
      {tab === "security" ? <SecuritySection supabase={ctx.supabase} elevated={elevated} superAdmin={superAdmin} userId={ctx.userId} /> : null}
    </>
  );
}

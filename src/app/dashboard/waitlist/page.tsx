import { Download, Users } from "lucide-react";
import { setWaitlistStatus } from "./actions";
import { ActionForm } from "@/components/action-form";
import { FilterTabs } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth/session";
import { type RawSearchParams, flatParams } from "@/lib/db/query";
import { formatDate } from "@/lib/domain/dates";

export const metadata = { title: "Lease-on waitlist" };

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireStaff({ admin: true });
  const params = flatParams(await searchParams);
  const status = params.status === "contacted" || params.status === "archived" ? params.status : "new";
  const { data } = await ctx.supabase.from("lease_on_waitlist").select("*").eq("status", status).order("created_at", { ascending: false }).limit(500);

  return (
    <>
      <PageHeader
        title="Lease-on waitlist"
        description="Drivers interested in leasing on once the company has its own operating authority. Lease-on operations are disabled."
        actions={
          // A plain link: the export is a file download from a route handler, not a page.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/api/exports/waitlist" className="inline-flex h-10 items-center gap-1.5 rounded-md border border-steel-300 bg-white px-3 text-sm font-semibold hover:bg-paper-2">
            <Download className="size-4" aria-hidden="true" /> CSV
          </a>
        }
      />
      <Alert tone="info" className="mb-6">
        Do not promise lease-on positions, pay or start dates. The company cannot lease drivers on until authority, insurance and attorney-approved lease documents are in place (see Settings → Lease-on readiness).
      </Alert>
      <FilterTabs
        base="/dashboard/waitlist"
        params={{ status: status === "new" ? undefined : status }}
        name="status"
        label="Waitlist status"
        options={[
          { value: undefined, label: "New" },
          { value: "contacted", label: "Contacted" },
          { value: "archived", label: "Archived" },
        ]}
      />
      {data && data.length ? (
        <Card>
          <Table caption="Lease-on waitlist">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Contact</TH>
                <TH>Location</TH>
                <TH>Experience</TH>
                <TH>Joined</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {data.map((w) => (
                <TR key={w.id}>
                  <TD className="font-medium">
                    {w.full_name}
                    <div className="mt-1">
                      <StatusBadge status={w.status} />
                    </div>
                  </TD>
                  <TD className="text-sm">
                    {w.email}
                    <div className="text-xs text-steel-600">{w.phone}</div>
                  </TD>
                  <TD>{[w.city, w.state].filter(Boolean).join(", ") || "—"}</TD>
                  <TD className="text-sm">
                    {[w.cdl_class ? `CDL ${w.cdl_class}` : null, w.years_experience !== null ? `${w.years_experience} yrs` : null, w.owns_truck ? "owns truck" : null].filter(Boolean).join(" · ") || "—"}
                    {w.equipment_interest ? <div className="text-xs text-steel-600">{w.equipment_interest}</div> : null}
                    {w.message ? <div className="mt-1 text-xs text-steel-700">“{w.message}”</div> : null}
                  </TD>
                  <TD>{formatDate(w.created_at)}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      {w.status !== "contacted" ? (
                        <ActionForm action={setWaitlistStatus} submitLabel="Mark contacted" submitVariant="secondary" submitSize="sm" inline>
                          <input type="hidden" name="id" value={w.id} />
                          <input type="hidden" name="status" value="contacted" />
                        </ActionForm>
                      ) : null}
                      {w.status !== "archived" ? (
                        <ActionForm action={setWaitlistStatus} submitLabel="Archive" submitVariant="ghost" submitSize="sm" inline>
                          <input type="hidden" name="id" value={w.id} />
                          <input type="hidden" name="status" value="archived" />
                        </ActionForm>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState icon={Users} title="No one in this list" />
      )}
    </>
  );
}

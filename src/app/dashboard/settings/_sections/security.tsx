import Link from "next/link";
import { inviteStaff, revokeStaffRole, saveAuthorityProfile, setFeatureFlag, setRequireAdminMfa } from "../actions";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { serverEnv } from "@/lib/env";
import { LEASE_ON_REQUIREMENTS, evaluateLeaseOn } from "@/lib/domain/lease-on";
import { getSecuritySettings } from "@/lib/auth/session";
import { listStaff, staffLabel } from "@/lib/staff";
import type { UserSupabaseClient } from "@/lib/supabase/server";

function ElevationNote({ elevated }: { elevated: boolean }) {
  if (elevated) return null;
  return (
    <Alert tone="info" className="mb-4">
      Security-sensitive changes require a super administrator who has verified with two-step authentication in this session.{" "}
      <Link href="/mfa?next=/dashboard/settings?tab=security" className="font-semibold underline">
        Verify now
      </Link>
    </Alert>
  );
}

export async function FlagsSection({ supabase, elevated }: { supabase: UserSupabaseClient; elevated: boolean }) {
  const [{ data: flags }, readiness, { data: profile }, staff, { data: leaseVersions }] = await Promise.all([
    supabase.from("feature_flags").select("*").order("key"),
    supabase.rpc("get_lease_on_readiness"),
    supabase.from("authority_profiles").select("*").eq("kind", "company").maybeSingle(),
    listStaff(supabase),
    supabase.from("agreement_versions").select("id, version, legal_review_status, agreements!inner(key)").eq("agreements.key", "owner_operator_lease"),
  ]);
  const ready = (readiness.data ?? {}) as Record<string, boolean>;
  const flagOn = (flags ?? []).find((f) => f.key === "lease_on_operations")?.enabled ?? false;
  const decision = evaluateLeaseOn({ envEnabled: serverEnv().LEASE_ON_OPERATIONS_ENABLED, flagEnabled: flagOn, requirements: ready });
  const admins = staff.filter((s) => s.roles.includes("admin") || s.roles.includes("super_admin"));

  return (
    <div className="space-y-6">
      <ElevationNote elevated={elevated} />
      <Card>
        <CardHeader>
          <CardTitle>Feature flags</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-steel-100">
          {(flags ?? []).map((f) => (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <span>
                <span className="font-mono text-xs">{f.key}</span> {f.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}{" "}
                {f.is_sensitive ? <Badge tone="navy">Sensitive</Badge> : null}
                <span className="block text-steel-700">{f.description}</span>
              </span>
              <ActionForm action={setFeatureFlag} submitLabel={f.enabled ? "Turn off" : "Turn on"} submitVariant="secondary" submitSize="sm" inline>
                <input type="hidden" name="key" value={f.key} />
                {f.enabled ? null : <input type="hidden" name="enabled" value="on" />}
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lease-on readiness</CardTitle>
          {decision.enabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="warning">Disabled</Badge>}
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          <p className="text-steel-700">
            Lease-on operations stay off until the company holds its own operating authority, insurance and BOC-3 filings are verified, a compliance administrator is named and an attorney has approved the owner-operator lease. The server flag LEASE_ON_OPERATIONS_ENABLED must also be true. The database enforces the same checklist.
          </p>
          <ul className="space-y-1">
            <li>{serverEnv().LEASE_ON_OPERATIONS_ENABLED ? "✓" : "✗"} Server flag LEASE_ON_OPERATIONS_ENABLED</li>
            {LEASE_ON_REQUIREMENTS.map((r) => (
              <li key={r.key}>
                {ready[r.key] ? "✓" : "✗"} {r.label}
              </li>
            ))}
          </ul>
          <FormDialog title="Company authority profile" description="Enter only real, verified information. These details unlock lease-on readiness checks; they are not displayed publicly." triggerLabel="Edit company authority" triggerVariant="secondary" triggerSize="sm">
            <ActionForm action={saveAuthorityProfile} submitLabel="Save authority profile">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="ap-legal" name="legal_name" label="Legal name on authority">
                  <Input name="legal_name" defaultValue={profile?.legal_name ?? ""} />
                </FormField>
                <FormField id="ap-dot" name="usdot_number" label="USDOT number">
                  <Input name="usdot_number" inputMode="numeric" defaultValue={profile?.usdot_number ?? ""} />
                </FormField>
                <FormField id="ap-mc" name="mc_number" label="MC number">
                  <Input name="mc_number" inputMode="numeric" defaultValue={profile?.mc_number ?? ""} />
                </FormField>
                <FormField id="ap-date" name="authority_effective_date" label="Authority effective date">
                  <Input name="authority_effective_date" type="date" defaultValue={profile?.authority_effective_date ?? ""} />
                </FormField>
                <FormField id="ap-admin" name="compliance_administrator_id" label="Compliance administrator">
                  <Select name="compliance_administrator_id" defaultValue={profile?.compliance_administrator_id ?? ""}>
                    <option value="">Not designated</option>
                    {admins.map((a) => (
                      <option key={a.user_id} value={a.user_id}>
                        {staffLabel(a)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="ap-lease" name="attorney_approved_lease_version_id" label="Attorney-approved lease version">
                  <Select name="attorney_approved_lease_version_id" defaultValue={profile?.attorney_approved_lease_version_id ?? ""}>
                    <option value="">None</option>
                    {(leaseVersions ?? [])
                      .filter((v) => v.legal_review_status === "attorney_approved")
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          v{v.version}
                        </option>
                      ))}
                  </Select>
                </FormField>
              </div>
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox name="insurance_filing_verified" defaultChecked={Boolean(profile?.insurance_filing_verified_at)} />
                  <span>Insurance filing verified with FMCSA</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox name="boc3_verified" defaultChecked={Boolean(profile?.boc3_verified_at)} />
                  <span>BOC-3 process agent filing verified</span>
                </label>
              </div>
              <FormField id="ap-notes" name="notes" label="Verification notes">
                <Textarea name="notes" rows={2} defaultValue={profile?.notes ?? ""} />
              </FormField>
            </ActionForm>
          </FormDialog>
        </CardBody>
      </Card>
    </div>
  );
}

export async function SecuritySection({ supabase, elevated, superAdmin, userId }: { supabase: UserSupabaseClient; elevated: boolean; superAdmin: boolean; userId: string }) {
  const [{ requireAdminMfa }, staff] = await Promise.all([getSecuritySettings(), listStaff(supabase)]);
  const ROLE_NAMES: Record<string, string> = { super_admin: "Super admin", admin: "Admin", dispatcher: "Dispatcher" };
  return (
    <div className="space-y-6">
      <ElevationNote elevated={elevated} />
      <Card>
        <CardHeader>
          <CardTitle>Two-step verification policy</CardTitle>
          {requireAdminMfa ? <Badge tone="success">Required for admins</Badge> : <Badge tone="warning">Optional</Badge>}
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          <p className="text-steel-700">When required, administrators must verify with an authenticator app before the dashboard or any admin database permission is available.</p>
          <p>
            <Link href="/mfa?next=/dashboard/settings?tab=security" className="font-semibold underline">
              Manage your two-step verification
            </Link>
          </p>
          {superAdmin ? (
            <ActionForm action={setRequireAdminMfa} submitLabel={requireAdminMfa ? "Make optional" : "Require for all admins"} submitVariant="secondary" submitSize="sm" inline>
              {requireAdminMfa ? null : <input type="hidden" name="require_admin_mfa" value="on" />}
            </ActionForm>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff users</CardTitle>
          <FormDialog title="Invite staff" description="Admins can invite dispatchers. Only a verified super admin can grant admin roles." triggerLabel="Invite staff" triggerVariant="secondary" triggerSize="sm">
            <ActionForm action={inviteStaff} submitLabel="Send invitation" successMessage="Invitation sent.">
              <FormField id="st-name" name="full_name" label="Full name" required>
                <Input name="full_name" maxLength={120} autoComplete="off" />
              </FormField>
              <FormField id="st-email" name="email" label="Email" required>
                <Input name="email" type="email" autoComplete="off" />
              </FormField>
              <FormField id="st-role" name="role" label="Role">
                <Select name="role" defaultValue="dispatcher">
                  <option value="dispatcher">Dispatcher</option>
                  {superAdmin ? <option value="admin">Admin</option> : null}
                  {superAdmin ? <option value="super_admin">Super admin</option> : null}
                </Select>
              </FormField>
            </ActionForm>
          </FormDialog>
        </CardHeader>
        <Table caption="Staff users">
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Roles</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {staff.map((s) => (
              <TR key={s.user_id}>
                <TD>
                  <span className="font-medium">{staffLabel(s)}</span>
                  <div className="text-xs text-steel-600">{s.email}</div>
                </TD>
                <TD>
                  {s.roles.map((r) => (
                    <Badge key={r} className="mr-1">
                      {ROLE_NAMES[r] ?? r}
                    </Badge>
                  ))}
                  {s.grants_all_carriers ? <Badge tone="accent">All carriers</Badge> : null}
                </TD>
                <TD className="text-right">
                  {s.user_id !== userId
                    ? s.roles
                        .filter((r) => r === "dispatcher" || superAdmin)
                        .map((r) => (
                          <ConfirmAction key={r} action={revokeStaffRole} title={`Remove ${ROLE_NAMES[r]} role?`} description={`${staffLabel(s)} loses this role immediately.`} triggerLabel={`Remove ${ROLE_NAMES[r]}`} triggerVariant="ghost" confirmLabel="Remove role">
                            <input type="hidden" name="user_id" value={s.user_id} />
                            <input type="hidden" name="role" value={r} />
                          </ConfirmAction>
                        ))
                    : null}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

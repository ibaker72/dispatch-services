import { inviteTeamMember, removeTeamMember, revokeTeamInvitation } from "../actions";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireCarrierUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/domain/dates";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireCarrierUser({ owner: true });
  const orgId = ctx.membership.organizationId;
  const [members, invitations] = await Promise.all([
    ctx.supabase
      .from("organization_members")
      .select("id, role, user_id, created_at, profiles!organization_members_user_id_fkey(full_name, email)")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .order("role"),
    ctx.supabase.from("organization_invitations").select("id, email, role, created_at, expires_at, accepted_at, revoked_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(20),
  ]);
  const now = new Date().toISOString();
  return (
    <>
      <PageHeader
        title="Team"
        description="Give office staff or drivers access to view loads and upload paperwork. Only owners approve loads, accept agreements and pay invoices."
        actions={
          <FormDialog title="Invite a team member" description="They receive a one-time link that expires in 7 days." triggerLabel="Invite team member">
            <ActionForm action={inviteTeamMember} submitLabel="Send invitation" successMessage="Invitation sent." resetOnSuccess>
              <FormField id="team-email" name="email" label="Email" required>
                <Input name="email" type="email" autoComplete="off" />
              </FormField>
            </ActionForm>
          </FormDialog>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>People with access</CardTitle>
          </CardHeader>
          <Table caption="Team members">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Since</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {(members.data ?? []).map((m) => (
                <TR key={m.id}>
                  <TD>
                    <span className="font-medium">{m.profiles?.full_name ?? m.profiles?.email}</span>
                    <div className="text-xs text-steel-600">{m.profiles?.email}</div>
                  </TD>
                  <TD>{m.role === "carrier_owner" ? "Owner" : "Team member"}</TD>
                  <TD>{formatDate(m.created_at)}</TD>
                  <TD className="text-right">
                    {m.role === "carrier_member" ? (
                      <ConfirmAction action={removeTeamMember} title="Remove access?" description="They will no longer be able to sign in to your portal." triggerLabel="Remove" triggerVariant="ghost" confirmLabel="Remove">
                        <input type="hidden" name="member_id" value={m.id} />
                      </ConfirmAction>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
          </CardHeader>
          {(invitations.data ?? []).length ? (
            <ul className="divide-y divide-steel-100">
              {invitations.data!.map((i) => {
                const status = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : i.expires_at < now ? "expired" : "pending";
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span>
                      {i.email} <StatusBadge status={status} />
                      <span className="block text-xs text-steel-600">Sent {formatDate(i.created_at)}</span>
                    </span>
                    {status === "pending" && i.role === "carrier_member" ? (
                      <ActionForm action={revokeTeamInvitation} submitLabel="Revoke" submitVariant="ghost" submitSize="sm" inline>
                        <input type="hidden" name="invitation_id" value={i.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <CardBody className="text-sm text-steel-600">No invitations sent.</CardBody>
          )}
        </Card>
      </div>
    </>
  );
}

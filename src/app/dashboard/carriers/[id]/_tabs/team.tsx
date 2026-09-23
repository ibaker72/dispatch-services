import type { CarrierTabProps } from "./types";
import { inviteCarrierUser, removeMember, revokeInvitation } from "../../actions";
import { ActionForm, ConfirmAction, FormDialog, FormField } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/dates";

export async function TeamTab({ ctx, carrier, admin }: CarrierTabProps) {
  const [members, invitations] = await Promise.all([
    ctx.supabase
      .from("organization_members")
      .select("id, role, status, created_at, profiles!organization_members_user_id_fkey(full_name, email, phone)")
      .eq("organization_id", carrier.organization_id)
      .eq("status", "active")
      .order("role"),
    ctx.supabase
      .from("organization_invitations")
      .select("id, email, role, created_at, expires_at, accepted_at, revoked_at")
      .eq("organization_id", carrier.organization_id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const hasOwner = (members.data ?? []).some((m) => m.role === "carrier_owner");
  const now = new Date().toISOString();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Portal users</CardTitle>
          {admin ? (
            <FormDialog title="Invite to carrier portal" description="The invitee receives a one-time link that expires in 7 days." triggerLabel="Invite user" triggerVariant="secondary" triggerSize="sm">
              <ActionForm action={inviteCarrierUser} submitLabel="Send invitation" successMessage="Invitation sent.">
                <input type="hidden" name="carrier_id" value={carrier.id} />
                <FormField id="invite-email" name="email" label="Email" required>
                  <Input name="email" type="email" defaultValue={hasOwner ? "" : (carrier.email ?? "")} autoComplete="off" />
                </FormField>
                <FormField id="invite-role" name="role" label="Role" required hint="Owners accept agreements, manage the team and pay invoices. Members view loads and upload documents.">
                  <Select name="role" defaultValue={hasOwner ? "carrier_member" : "carrier_owner"}>
                    <option value="carrier_owner">Owner</option>
                    <option value="carrier_member">Member</option>
                  </Select>
                </FormField>
              </ActionForm>
            </FormDialog>
          ) : null}
        </CardHeader>
        {(members.data ?? []).length ? (
          <Table caption="Portal users">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Since</TH>
                {admin ? (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </tr>
            </THead>
            <tbody>
              {members.data!.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <span className="font-medium">{m.profiles?.full_name ?? m.profiles?.email}</span>
                    <div className="text-xs text-steel-600">{m.profiles?.email}</div>
                  </TD>
                  <TD>{m.role === "carrier_owner" ? "Owner" : "Member"}</TD>
                  <TD>{formatDate(m.created_at)}</TD>
                  {admin ? (
                    <TD className="text-right">
                      <ConfirmAction action={removeMember} title="Remove portal access?" description="The user can no longer sign in to this carrier's portal. The last owner cannot be removed." triggerLabel="Remove" triggerVariant="ghost" confirmLabel="Remove access">
                        <input type="hidden" name="member_id" value={m.id} />
                      </ConfirmAction>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardBody className="text-sm text-warning">No one has portal access yet. Invite the carrier owner to start onboarding.</CardBody>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
        </CardHeader>
        {(invitations.data ?? []).length ? (
          <Table caption="Invitations">
            <THead>
              <tr>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Sent</TH>
                <TH>Status</TH>
                {admin ? (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </tr>
            </THead>
            <tbody>
              {invitations.data!.map((i) => {
                const status = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : i.expires_at < now ? "expired" : "pending";
                return (
                  <TR key={i.id}>
                    <TD>{i.email}</TD>
                    <TD>{i.role === "carrier_owner" ? "Owner" : "Member"}</TD>
                    <TD>{formatDate(i.created_at)}</TD>
                    <TD>
                      <StatusBadge status={status} />
                    </TD>
                    {admin ? (
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          {status !== "accepted" ? (
                            <ActionForm action={inviteCarrierUser} submitLabel="Resend" submitVariant="secondary" submitSize="sm" inline>
                              <input type="hidden" name="carrier_id" value={carrier.id} />
                              <input type="hidden" name="email" value={i.email} />
                              <input type="hidden" name="role" value={i.role} />
                            </ActionForm>
                          ) : null}
                          {status === "pending" ? (
                            <ActionForm action={revokeInvitation} submitLabel="Revoke" submitVariant="ghost" submitSize="sm" inline>
                              <input type="hidden" name="invitation_id" value={i.id} />
                            </ActionForm>
                          ) : null}
                        </div>
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <CardBody className="text-sm text-steel-600">No invitations sent.</CardBody>
        )}
      </Card>
    </div>
  );
}

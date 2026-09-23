import "server-only";
import { sendEmailSafely } from "@/lib/email/send";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { randomToken, sha256Hex } from "@/lib/security/tokens";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserSupabaseClient } from "@/lib/supabase/server";

export const INVITATION_TTL_DAYS = 7;

/**
 * Creates a one-time Supabase Auth link for `email` that lands on `nextPath`
 * after verification. New addresses get an invite link (the account is
 * created unconfirmed); existing accounts get a magic link. The link goes
 * through /auth/confirm, so it works in any browser.
 */
export async function createAuthLink(email: string, nextPath: string): Promise<{ url: string; userId: string | null }> {
  const admin = createSupabaseAdminClient();
  const redirectTo = `${siteUrl()}${nextPath}`;
  let type: "invite" | "magiclink" = "invite";
  let result = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (result.error && (result.error.code === "email_exists" || /already (been )?registered/i.test(result.error.message))) {
    type = "magiclink";
    result = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
  }
  const hashed = result.data?.properties?.hashed_token;
  if (result.error || !hashed) {
    console.error("[invitations] generateLink failed", result.error?.code ?? "no_token");
    throw new AppError("We could not create a sign-in link for that email address.");
  }
  const params = new URLSearchParams({ token_hash: hashed, type, next: nextPath });
  return { url: `${siteUrl()}/auth/confirm?${params.toString()}`, userId: result.data?.user?.id ?? null };
}

/**
 * Records an organization invitation with the caller's own client (RLS: admins
 * for any role, carrier owners only for team members) and returns the link to
 * email. Only the SHA-256 of the token is stored.
 */
export async function createOrganizationInvitation(
  supabase: UserSupabaseClient,
  opts: { organizationId: string; email: string; role: "carrier_owner" | "carrier_member"; invitedBy: string },
): Promise<{ invitationId: string; acceptUrl: string }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();

  // Revoke earlier open invitations for the same address so only the newest link works.
  await supabase
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", opts.organizationId)
    .eq("email", opts.email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { data, error } = await supabase
    .from("organization_invitations")
    .insert({
      organization_id: opts.organizationId,
      email: opts.email,
      role: opts.role,
      token_hash: sha256Hex(token),
      invited_by: opts.invitedBy,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new AppError(error?.code === "42501" ? "You do not have permission to invite users to this carrier." : "We could not create the invitation.");
  }
  const { url: acceptUrl } = await createAuthLink(opts.email, `/invite/accept?token=${encodeURIComponent(token)}`);
  return { invitationId: data.id, acceptUrl };
}

/**
 * Invites someone to a carrier's portal and emails them the link. The
 * invitation insert runs with the caller's client, so RLS decides whether the
 * caller may invite (admins: owners or members; carrier owners: members).
 */
export async function sendCarrierInvitation(
  supabase: UserSupabaseClient,
  opts: { carrierId: string; email: string; role: "carrier_owner" | "carrier_member"; invitedBy: string; inviterName?: string | null },
): Promise<void> {
  await enforceRateLimit("invite", opts.invitedBy);
  const { data: carrier } = await supabase.from("carriers").select("organization_id, legal_name").eq("id", opts.carrierId).maybeSingle();
  if (!carrier) throw new AppError("Carrier not found.", "not_found");
  const { acceptUrl } = await createOrganizationInvitation(supabase, {
    organizationId: carrier.organization_id,
    email: opts.email,
    role: opts.role,
    invitedBy: opts.invitedBy,
  });
  await sendEmailSafely({
    to: opts.email,
    template: "portal_invitation",
    data: {
      inviterName: opts.inviterName,
      carrierName: carrier.legal_name,
      acceptUrl,
      expiresInDays: INVITATION_TTL_DAYS,
      role: opts.role === "carrier_owner" ? "owner" : "member",
    },
    carrierId: opts.carrierId,
    visibility: "carrier",
  });
}

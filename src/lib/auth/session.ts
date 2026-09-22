import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Tables } from "@/lib/db/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type UserSupabaseClient, createSupabaseServerClient } from "@/lib/supabase/server";

export type StaffRole = "super_admin" | "admin" | "dispatcher";
export type CarrierRole = "carrier_owner" | "carrier_member";

export interface CarrierMembership {
  organizationId: string;
  carrierId: string | null;
  role: CarrierRole;
  carrierName: string | null;
  carrierStatus: Tables<"carriers">["status"] | null;
}

export interface AuthContext {
  supabase: UserSupabaseClient;
  userId: string;
  email: string;
  emailVerified: boolean;
  profile: Pick<Tables<"profiles">, "id" | "email" | "full_name" | "phone" | "timezone" | "deactivated_at"> | null;
  staffRoles: StaffRole[];
  grantsAllCarriers: boolean;
  membership: CarrierMembership | null;
  aal: "aal1" | "aal2";
  hasVerifiedMfaFactor: boolean;
}

/**
 * Loads the signed-in user once per request. `getUser()` validates the
 * session with the auth server (never trusting cookie contents alone).
 * Every query uses the user's own client, so RLS applies.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, rolesRes, membershipRes, aalRes] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, phone, timezone, deactivated_at").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role, grants_all_carriers").eq("user_id", user.id).is("revoked_at", null),
    supabase
      .from("organization_members")
      .select("organization_id, role, organizations(carriers(id, legal_name, status))")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const staffRoles = (rolesRes.data ?? []).map((r) => r.role as StaffRole);
  const m = membershipRes.data;
  // carriers.organization_id is unique, so the embedded relation is a single object.
  const carrier = m?.organizations?.carriers ?? null;

  return {
    supabase,
    userId: user.id,
    email: user.email ?? "",
    emailVerified: Boolean(user.email_confirmed_at),
    profile: profileRes.data ?? null,
    staffRoles,
    grantsAllCarriers: (rolesRes.data ?? []).some((r) => r.grants_all_carriers),
    membership: m
      ? {
          organizationId: m.organization_id,
          role: m.role as CarrierRole,
          carrierId: carrier?.id ?? null,
          carrierName: carrier?.legal_name ?? null,
          carrierStatus: carrier?.status ?? null,
        }
      : null,
    aal: (aalRes.data?.currentLevel as "aal1" | "aal2" | null) ?? "aal1",
    hasVerifiedMfaFactor: (user.factors ?? []).some((f) => f.status === "verified"),
  };
});

export const isAdminRole = (roles: StaffRole[]) => roles.includes("admin") || roles.includes("super_admin");

/** Reads the security settings with the service role (admins without MFA cannot read settings through RLS). */
export const getSecuritySettings = cache(async (): Promise<{ requireAdminMfa: boolean }> => {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("app_settings").select("value").eq("key", "security").maybeSingle();
    const value = (data?.value ?? {}) as { require_admin_mfa?: boolean };
    return { requireAdminMfa: value.require_admin_mfa === true };
  } catch {
    return { requireAdminMfa: false };
  }
});

export async function requireUser(nextPath = "/"): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!ctx.emailVerified) redirect("/verify-email");
  if (ctx.profile?.deactivated_at) redirect("/login?error=deactivated");
  return ctx;
}

export interface StaffOptions {
  admin?: boolean;
  superAdmin?: boolean;
  nextPath?: string;
}

/**
 * Page/action guard for internal staff. This is a usability and
 * defense-in-depth layer; the database enforces the same rules through RLS.
 */
export async function requireStaff(opts: StaffOptions = {}): Promise<AuthContext> {
  const ctx = await requireUser(opts.nextPath ?? "/dashboard");
  if (ctx.staffRoles.length === 0) redirect(ctx.membership ? "/portal" : "/login?error=no_access");
  const admin = isAdminRole(ctx.staffRoles);
  if (admin) {
    const { requireAdminMfa } = await getSecuritySettings();
    if (requireAdminMfa && ctx.aal !== "aal2") redirect(`/mfa?next=${encodeURIComponent(opts.nextPath ?? "/dashboard")}`);
  }
  if (opts.superAdmin && !ctx.staffRoles.includes("super_admin")) redirect("/dashboard?error=forbidden");
  if (opts.admin && !admin) redirect("/dashboard?error=forbidden");
  return ctx;
}

export interface CarrierContext extends AuthContext {
  membership: CarrierMembership & { carrierId: string };
}

export async function requireCarrierUser(opts: { owner?: boolean; nextPath?: string } = {}): Promise<CarrierContext> {
  const ctx = await requireUser(opts.nextPath ?? "/portal");
  if (!ctx.membership?.carrierId) redirect(ctx.staffRoles.length ? "/dashboard" : "/login?error=no_access");
  if (opts.owner && ctx.membership.role !== "carrier_owner") redirect("/portal?error=owner_only");
  return ctx as CarrierContext;
}

export function homePathFor(ctx: Pick<AuthContext, "staffRoles" | "membership">): string {
  if (ctx.staffRoles.length) return "/dashboard";
  if (ctx.membership) return "/portal";
  return "/";
}

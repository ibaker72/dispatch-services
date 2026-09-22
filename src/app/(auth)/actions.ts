"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/actions";
import { trackServer } from "@/lib/analytics/server";
import { getAuthContext, getSecuritySettings, homePathFor, isAdminRole } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { safeRedirectPath } from "@/lib/security/redirect";
import { clientIp, userAgent } from "@/lib/security/request";
import { sha256Hex } from "@/lib/security/tokens";
import { absoluteUrl, siteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validation/common";

export const PASSWORD_MIN_LENGTH = 12;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use letters and at least one number");

async function recordFailedLogin(email: string) {
  try {
    const h = await headers();
    await createSupabaseAdminClient()
      .from("audit_events")
      .insert({
        actor_kind: "system",
        action: "auth.login_failed",
        entity_type: "user",
        severity: "security",
        ip_address: clientIp(h),
        user_agent: userAgent(h),
        metadata: { email_sha256: sha256Hex(email.toLowerCase()) },
      });
  } catch {
    // Audit failures must not change the login response.
  }
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Decides where to go after sign-in using the freshly authenticated client (RLS-scoped reads). */
async function destinationAfterLogin(supabase: ServerClient, userId: string, next: string | undefined) {
  const [roles, membership, aal, factors] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId).is("revoked_at", null),
    supabase.from("organization_members").select("role").eq("user_id", userId).eq("status", "active").maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const staffRoles = (roles.data ?? []).map((r) => r.role) as Array<"super_admin" | "admin" | "dispatcher">;
  const home = homePathFor({ staffRoles, membership: membership.data });
  const target = safeRedirectPath(next, home, siteUrl());
  if (isAdminRole(staffRoles)) {
    const { requireAdminMfa } = await getSecuritySettings();
    const hasFactor = (factors.data?.totp ?? []).some((f) => f.status === "verified");
    if ((requireAdminMfa || hasFactor) && aal.data?.currentLevel !== "aal2") return { target: `/mfa?next=${encodeURIComponent(target)}`, staff: true };
  }
  return { target, staff: staffRoles.length > 0 };
}

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password").max(128), next: z.string().max(2048).optional() });

export async function signInWithPassword(input: z.input<typeof loginSchema>): Promise<ActionResult<null>> {
  const result = await runAction(loginSchema, input, async ({ email, password, next }) => {
    const ip = clientIp(await headers());
    await enforceRateLimit("loginIp", ip);
    await enforceRateLimit("loginEmail", email);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      await recordFailedLogin(email);
      if (error?.code === "email_not_confirmed") throw new AppError("Please confirm your email address first. Check your inbox for the link.");
      throw new AppError("That email and password combination is not correct.");
    }
    await supabase.rpc("log_security_event", { p_action: "auth.login", p_metadata: { detail: "password" } });
    const { target, staff } = await destinationAfterLogin(supabase, data.user.id, next);
    await trackServer("login_completed", data.user.id, { method: "password", audience: staff ? "staff" : "carrier" });
    return target;
  });
  if (result.ok) redirect(result.data);
  return result;
}

const magicSchema = z.object({ email: emailSchema, next: z.string().max(2048).optional() });

export async function sendMagicLink(input: z.input<typeof magicSchema>): Promise<ActionResult<null>> {
  return runAction(magicSchema, input, async ({ email, next }) => {
    await enforceRateLimit("magicLink", email);
    await enforceRateLimit("loginIp", clientIp(await headers()));
    const supabase = await createSupabaseServerClient();
    const target = safeRedirectPath(next, "/", siteUrl());
    // shouldCreateUser=false: accounts are created only by invitation. The
    // response is identical whether or not the address has an account.
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: absoluteUrl(target) } });
    return null;
  });
}

export async function requestPasswordReset(input: { email: string }): Promise<ActionResult<null>> {
  return runAction(z.object({ email: emailSchema }), input, async ({ email }) => {
    await enforceRateLimit("passwordReset", email);
    await enforceRateLimit("loginIp", clientIp(await headers()));
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: absoluteUrl("/reset-password") });
    return null;
  });
}

const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export async function updatePassword(input: z.input<typeof newPasswordSchema>): Promise<ActionResult<null>> {
  const result = await runAction(newPasswordSchema, input, async ({ password }) => {
    const ctx = await getAuthContext();
    if (!ctx) throw new AppError("Your reset link has expired. Request a new one.");
    const { error } = await ctx.supabase.auth.updateUser({ password });
    if (error) throw new AppError(error.code === "same_password" ? "Choose a password you have not used before." : "We could not update your password.");
    await ctx.supabase.rpc("log_security_event", { p_action: "auth.password_changed" });
    return homePathFor(ctx);
  });
  if (result.ok) redirect(result.data);
  return result;
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) await supabase.rpc("log_security_event", { p_action: "auth.logout" });
  await supabase.auth.signOut();
  redirect("/login?signed_out=1");
}

export async function resendVerification(input: { email: string }): Promise<ActionResult<null>> {
  return runAction(z.object({ email: emailSchema }), input, async ({ email }) => {
    await enforceRateLimit("magicLink", email);
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: absoluteUrl("/") } });
    return null;
  });
}

// ---- MFA (TOTP) --------------------------------------------------------------
export async function startTotpEnrollment(): Promise<ActionResult<{ factorId: string; qrCode: string; secret: string }>> {
  return runAction(z.object({}), {}, async () => {
    const ctx = await getAuthContext();
    if (!ctx) throw new AppError("Please sign in again.");
    await enforceRateLimit("mfa", ctx.userId);
    // Remove abandoned unverified factors so enrollment can be restarted.
    const { data: factors } = await ctx.supabase.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) {
      if (f.status === "unverified") await ctx.supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await ctx.supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) throw new AppError("Could not start MFA enrollment.");
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  });
}

const verifySchema = z.object({ factorId: z.string().min(1).max(100), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"), next: z.string().max(2048).optional() });

export async function verifyTotp(input: z.input<typeof verifySchema>): Promise<ActionResult<null>> {
  const result = await runAction(verifySchema, input, async ({ factorId, code, next }) => {
    const ctx = await getAuthContext();
    if (!ctx) throw new AppError("Please sign in again.");
    await enforceRateLimit("mfa", ctx.userId);
    const wasVerified = ctx.hasVerifiedMfaFactor;
    const { error } = await ctx.supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new AppError("That code is not valid. Check your authenticator app and try again.");
    await ctx.supabase.rpc("log_security_event", { p_action: wasVerified ? "auth.mfa_verified" : "auth.mfa_enrolled" });
    return safeRedirectPath(next, homePathFor(ctx), siteUrl());
  });
  if (result.ok) redirect(result.data);
  return result;
}

// ---- Invitations -------------------------------------------------------------
const acceptSchema = z
  .object({
    token: z.string().max(200).optional(),
    fullName: z.string().trim().min(2, "Enter your name").max(120),
    phone: z.string().trim().max(40).optional(),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export async function acceptInvitation(input: z.input<typeof acceptSchema>): Promise<ActionResult<null>> {
  const result = await runAction(acceptSchema, input, async ({ token, fullName, phone, password }) => {
    const ctx = await getAuthContext();
    if (!ctx) throw new AppError("Your invitation link has expired. Sign in with the email your invitation was sent to.");
    const { error: pwError } = await ctx.supabase.auth.updateUser({ password, data: { full_name: fullName } });
    if (pwError && pwError.code !== "same_password") throw new AppError("We could not set your password.");
    await ctx.supabase.from("profiles").update({ full_name: fullName, phone: phone || null }).eq("id", ctx.userId);
    if (token) {
      const { error } = await ctx.supabase.rpc("accept_organization_invitation", { p_token: token });
      if (error) throw new AppError(error.message);
    }
    await ctx.supabase.rpc("log_security_event", { p_action: "auth.password_changed", p_metadata: { detail: "invitation" } });
    const fresh = await createSupabaseServerClient();
    const { data: membership } = await fresh.from("organization_members").select("role").eq("user_id", ctx.userId).eq("status", "active").maybeSingle();
    if (membership) return membership.role === "carrier_owner" ? "/portal/onboarding" : "/portal";
    return ctx.staffRoles.length ? "/dashboard" : "/";
  });
  if (result.ok) redirect(result.data);
  return result;
}

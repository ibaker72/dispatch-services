import { redirect } from "next/navigation";
import { MfaFlow } from "./mfa-flow";
import { getAuthContext } from "@/lib/auth/session";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Two-step verification", description: "Verify your identity.", path: "/mfa", noIndex: true });

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const ctx = await getAuthContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(`/mfa${next ? `?next=${encodeURIComponent(next)}` : ""}`)}`);
  const { data } = await ctx.supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).find((f) => f.status === "verified");
  return (
    <>
      <h1 className="text-2xl font-semibold">Two-step verification</h1>
      <p className="mt-1 mb-6 text-sm text-steel-600">
        {verified
          ? "Enter the 6-digit code from your authenticator app."
          : "Administrative accounts use an authenticator app (Google Authenticator, 1Password, Authy, etc.) as a second step."}
      </p>
      <MfaFlow factorId={verified?.id ?? null} next={next} />
    </>
  );
}

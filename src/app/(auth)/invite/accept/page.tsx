import { redirect } from "next/navigation";
import { AcceptInvitationForm } from "./form";
import { getAuthContext } from "@/lib/auth/session";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Accept invitation", description: "Finish setting up your account.", path: "/invite/accept", noIndex: true });

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const ctx = await getAuthContext();
  if (!ctx) {
    const next = `/invite/accept${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return (
    <>
      <h1 className="text-2xl font-semibold">Finish setting up your account</h1>
      <p className="mt-1 mb-6 text-sm text-steel-600">Signed in as {ctx.email}. Choose a password so you can sign in any time.</p>
      <AcceptInvitationForm token={token} defaultName={ctx.profile?.full_name ?? ""} />
    </>
  );
}

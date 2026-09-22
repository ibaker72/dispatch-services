import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForms } from "./login-forms";
import { Alert } from "@/components/ui/alert";
import { getAuthContext, homePathFor } from "@/lib/auth/session";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Log in",
  description: "Sign in to the carrier portal or dispatch dashboard.",
  path: "/login",
  noIndex: true,
});

const MESSAGES: Record<string, { tone: "warning" | "danger" | "info" | "success"; text: string }> = {
  link_invalid: { tone: "warning", text: "That link is invalid or has expired. Request a new one below." },
  deactivated: { tone: "danger", text: "This account has been deactivated. Contact us if you think this is a mistake." },
  no_access: { tone: "warning", text: "Your account does not have access yet. If you were invited, use the link in your invitation email." },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; signed_out?: string; confirmed?: string }> }) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  if (ctx && ctx.emailVerified && !params.error) redirect(homePathFor(ctx));
  const message = params.error ? MESSAGES[params.error] : undefined;
  return (
    <>
      <h1 className="text-2xl font-semibold">Log in</h1>
      <p className="mt-1 mb-6 text-sm text-steel-600">Carrier portal and dispatch dashboard</p>
      {message ? (
        <Alert tone={message.tone} className="mb-5">
          {message.text}
        </Alert>
      ) : null}
      {params.signed_out ? (
        <Alert tone="success" className="mb-5">
          You have been signed out.
        </Alert>
      ) : null}
      <LoginForms next={params.next} />
      <p className="mt-6 text-center text-sm text-steel-600">
        New carrier?{" "}
        <Link href="/apply" className="font-medium text-navy-700 underline underline-offset-2">
          Apply for dispatch
        </Link>
      </p>
    </>
  );
}

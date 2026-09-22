import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Confirm your email", description: "Email confirmation required.", path: "/verify-email", noIndex: true });

export default function VerifyEmailPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Confirm your email address</h1>
      <p className="mt-3 text-[15px] text-steel-700">
        For security, portal access requires a confirmed email address. Open the invitation or confirmation link we emailed you. If it has
        expired, request a new sign-in link from the log-in page or ask your dispatcher to resend your invitation.
      </p>
      <Link href="/login" className="mt-6 inline-block font-semibold text-navy-700 underline">
        Back to log in
      </Link>
    </>
  );
}

import { redirect } from "next/navigation";
import { NewPasswordForm } from "./form";
import { getAuthContext } from "@/lib/auth/session";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Choose a new password", description: "Set a new password.", path: "/reset-password", noIndex: true });

export default async function ResetPasswordPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?error=link_invalid");
  return (
    <>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="mt-1 mb-6 text-sm text-steel-600">Use at least 12 characters, including letters and a number.</p>
      <NewPasswordForm />
    </>
  );
}

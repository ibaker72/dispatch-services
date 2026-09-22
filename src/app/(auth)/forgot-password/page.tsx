import { ForgotPasswordForm } from "./form";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Reset your password", description: "Request a password reset link.", path: "/forgot-password", noIndex: true });

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 mb-6 text-sm text-steel-600">Enter your email and we will send a link to choose a new password.</p>
      <ForgotPasswordForm />
    </>
  );
}

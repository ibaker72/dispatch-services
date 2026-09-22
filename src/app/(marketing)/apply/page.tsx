import { CheckCircle2, Clock, FileText, ShieldCheck } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { StartApplicationButton } from "@/components/application/start-button";
import { ApplicationWizard } from "@/components/application/wizard";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { APPLICATION_DOCUMENT_TYPES, DRAFT_COOKIE, findByToken, isEditable, listDocuments } from "@/lib/applications/service";
import { formatDate } from "@/lib/domain/dates";
import { pageMetadata } from "@/lib/seo";
import { getApplicationQuestions } from "@/lib/settings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { StepKey } from "@/lib/validation/application";

export const metadata = pageMetadata({
  title: "Carrier Application",
  description: "Apply for truck dispatch. About 10 minutes; progress saves as you go. For carriers with their own active authority and insurance.",
  path: "/apply",
});

const CHECKLIST = [
  "Your MC and USDOT numbers and authority date",
  "Truck and trailer details, and who drives them",
  "Preferred lanes, minimum rate per mile and available days",
  "A W-9, certificate of insurance and your authority letter (PDF or photo)",
];

const STATUS_COPY: Record<string, string> = {
  submitted: "Thanks — we received your application. Our team will review it, usually within two business days.",
  under_review: "Our team is reviewing your application. We will contact you if we need anything.",
  approved: "Your application was approved. Watch your email for your carrier portal invitation.",
  onboarding: "You are in onboarding. Sign in to your carrier portal to finish the checklist.",
  active: "Your carrier account is active. Sign in to your carrier portal.",
  declined: "We are not able to offer dispatch services for this application right now. Thank you for your interest.",
  inactive: "This carrier account is inactive. Contact us if you would like to restart service.",
};

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ resume?: string }> }) {
  const { resume } = await searchParams;
  const admin = createSupabaseAdminClient();
  const app = await findByToken(admin, (await cookies()).get(DRAFT_COOKIE)?.value);

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mb-8 max-w-3xl">
        <p className="text-sm font-semibold tracking-wide text-accent-ink uppercase">Carrier application</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Apply for dispatch</h1>
        <p className="mt-3 text-lg text-steel-600">For motor carriers with their own active authority and insurance. About 10 minutes; your progress saves automatically.</p>
      </div>
      {resume === "invalid" ? (
        <Alert tone="warning" title="That resume link has expired" className="mb-6 max-w-3xl">
          Start a new application below, or contact us if you need help.
        </Alert>
      ) : null}

      {!app ? (
        <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-lg border border-steel-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-semibold">What you will need</h2>
            <ul className="mt-4 space-y-3 text-[15px] text-steel-700">
              {CHECKLIST.map((item) => (
                <li key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <StartApplicationButton />
            </div>
          </div>
          <aside className="space-y-4 text-sm text-steel-700">
            <div className="flex gap-3 rounded-lg border border-steel-200 bg-paper-2 p-4">
              <Clock className="mt-0.5 size-5 shrink-0 text-navy-700" aria-hidden="true" />
              <p>Leave and come back any time on this device, or email yourself a link to continue elsewhere.</p>
            </div>
            <div className="flex gap-3 rounded-lg border border-steel-200 bg-paper-2 p-4">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-navy-700" aria-hidden="true" />
              <p>We never ask for Social Security numbers, full EINs or bank logins. Documents are stored privately.</p>
            </div>
            <div className="flex gap-3 rounded-lg border border-steel-200 bg-paper-2 p-4">
              <FileText className="mt-0.5 size-5 shrink-0 text-navy-700" aria-hidden="true" />
              <p>
                Applying does not commit you to anything. Read our <Link className="font-medium text-navy-700 underline" href="/dispatch-disclosure">dispatch relationship disclosure</Link>.
              </p>
            </div>
          </aside>
        </div>
      ) : isEditable(app.status) ? (
        <ApplicationWizard initial={await wizardInitial(admin, app)} />
      ) : (
        <div className="max-w-2xl rounded-lg border border-steel-200 bg-white p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">{app.legal_name ?? "Your application"}</h2>
            <StatusBadge status={app.status} />
          </div>
          <p className="mt-3 text-[15px] text-steel-700">{STATUS_COPY[app.status] ?? ""}</p>
          {app.submitted_at ? <p className="mt-2 text-sm text-steel-600">Submitted {formatDate(app.submitted_at)}</p> : null}
          {["approved", "onboarding", "active"].includes(app.status) ? (
            <Link href="/login" className="mt-6 inline-block font-semibold text-navy-700 underline">
              Sign in to the carrier portal
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

async function wizardInitial(admin: ReturnType<typeof createSupabaseAdminClient>, app: NonNullable<Awaited<ReturnType<typeof findByToken>>>) {
  const [documents, requirementsRes, questions] = await Promise.all([
    listDocuments(admin, app.id),
    admin
      .from("document_requirements")
      .select("doc_type, label, description, required_for_application, sort_order")
      .eq("active", true)
      .eq("applies_to", "carrier")
      .in("doc_type", [...APPLICATION_DOCUMENT_TYPES])
      .order("sort_order"),
    getApplicationQuestions(),
  ]);
  return {
    status: app.status,
    currentStep: app.current_step,
    completedSteps: app.completed_steps ?? [],
    formData: (app.form_data ?? {}) as Partial<Record<StepKey, Record<string, unknown>>>,
    documents,
    requirements: requirementsRes.data ?? [],
    questions,
    informationRequest: app.information_request,
  };
}

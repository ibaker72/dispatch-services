/**
 * Transactional email templates. Each template receives typed data and
 * returns structured content that the layout renders to HTML + plain text.
 * Admins may override the subject and introduction per template
 * (Dashboard → Settings → Email templates); bodies stay code-reviewed.
 */
import type { EmailContent } from "./layout";

type Money = string;

export interface TemplateData {
  application_received: { contactName: string; resumeUrl?: string };
  application_resume_link: { contactName: string; resumeUrl: string; expiresOn: string };
  application_status_changed: { contactName: string; statusLabel: string; note?: string | null };
  information_requested: { contactName: string; request: string; resumeUrl: string };
  application_approved: { contactName: string; carrierName: string; nextSteps: string };
  portal_invitation: { inviterName?: string | null; carrierName: string; acceptUrl: string; expiresInDays: number; role: "owner" | "member" };
  staff_invitation: { inviterName?: string | null; roleLabel: string; acceptUrl: string };
  agreement_accepted: { signerName: string; agreementTitle: string; version: string; acceptedAt: string; documentHash: string };
  missing_document_reminder: { carrierName: string; documents: string[]; portalUrl: string };
  expiring_insurance_reminder: { carrierName: string; documentLabel: string; expiresOn: string; daysRemaining: number; portalUrl: string };
  proposed_load_review: { carrierName: string; reference: string; lane: string; pickupWindow: string; grossRate: Money; ratePerMile: string; reviewUrl: string };
  load_status_update: { carrierName: string; reference: string; lane: string; statusLabel: string; note?: string | null; loadUrl: string };
  weekly_statement_ready: { carrierName: string; periodLabel: string; completedLoads: number; grossRevenue: Money; dispatchFee: Money; amountDue: Money; statementUrl: string };
  invoice_due: { carrierName: string; invoiceNumber: string; amountDue: Money; dueDate: string; overdue: boolean; invoiceUrl: string };
  payment_received: { carrierName: string; invoiceNumber: string; amount: Money; method: string; receivedOn: string; invoiceUrl: string };
  support_request_confirmation: { name: string; subject: string; reference: string; portalUrl: string };
  support_request_update: { name: string; subject: string; statusLabel: string; message: string; portalUrl: string };
  admin_new_application: { legalName: string; equipment: string; truckCount: string; reviewUrl: string };
  admin_support_request: { carrierName: string; category: string; subject: string; reviewUrl: string };
  daily_operations_summary: { date: string; lines: Array<[string, string]>; dashboardUrl: string };
  contact_message: { topic: string; name: string; email: string; phone: string; message: string };
}

export type TemplateKey = keyof TemplateData;

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  application_received: "Application received",
  application_resume_link: "Finish your application later",
  application_status_changed: "Application status changed",
  information_requested: "More information requested",
  application_approved: "Application approved",
  portal_invitation: "Portal invitation",
  staff_invitation: "Staff account invitation",
  agreement_accepted: "Agreement accepted",
  missing_document_reminder: "Missing document reminder",
  expiring_insurance_reminder: "Expiring insurance reminder",
  proposed_load_review: "Proposed load awaiting review",
  load_status_update: "Load status update",
  weekly_statement_ready: "Weekly statement ready",
  invoice_due: "Invoice due",
  payment_received: "Payment received",
  support_request_confirmation: "Support request confirmation",
  support_request_update: "Support request update",
  admin_new_application: "Admin: new application",
  admin_support_request: "Admin: new support request",
  daily_operations_summary: "Admin: daily operations summary",
  contact_message: "Admin: contact form message",
};

type Builder<K extends TemplateKey> = (d: TemplateData[K]) => EmailContent;

export const TEMPLATES: { [K in TemplateKey]: Builder<K> } = {
  application_received: (d) => ({
    subject: "We received your dispatch application",
    heading: `Thanks, ${d.contactName}`,
    paragraphs: [
      "We received your carrier application. A member of our team will review your authority, insurance and equipment details and contact you, usually within two business days.",
      "Nothing is booked on your behalf until you have signed a dispatch agreement and approved a specific load.",
    ],
    cta: d.resumeUrl ? { label: "View your application", url: d.resumeUrl } : undefined,
  }),
  application_resume_link: (d) => ({
    subject: "Your link to finish your dispatch application",
    heading: "Pick up where you left off",
    paragraphs: [`Hi ${d.contactName}, your application progress is saved. Use the link below to continue on any device.`],
    cta: { label: "Continue your application", url: d.resumeUrl },
    footnote: `This link is personal to your application and works until ${d.expiresOn}. Please do not forward it.`,
  }),
  application_status_changed: (d) => ({
    subject: `Your application status: ${d.statusLabel}`,
    heading: "Application update",
    paragraphs: [`Hi ${d.contactName}, your application status is now "${d.statusLabel}".`, ...(d.note ? [d.note] : [])],
  }),
  information_requested: (d) => ({
    subject: "We need a little more information for your application",
    heading: "More information needed",
    paragraphs: [`Hi ${d.contactName}, before we can finish reviewing your application we need the following:`, d.request],
    cta: { label: "Update your application", url: d.resumeUrl },
    footnote: "This link is personal to your application. Please do not forward it.",
  }),
  application_approved: (d) => ({
    subject: "Your dispatch application was approved",
    heading: `Welcome aboard, ${d.carrierName}`,
    paragraphs: [
      `Hi ${d.contactName}, your application has been approved.`,
      d.nextSteps,
      "You will receive a separate email with a link to set up your carrier portal account.",
    ],
  }),
  portal_invitation: (d) => ({
    subject: `Set up your ${d.carrierName} portal account`,
    heading: "Your carrier portal invitation",
    paragraphs: [
      `${d.inviterName ? `${d.inviterName} invited you` : "You have been invited"} to the carrier portal for ${d.carrierName} as ${d.role === "owner" ? "the account owner" : "a team member"}.`,
      "In the portal you can review proposed loads, upload documents, see weekly statements and pay invoices.",
    ],
    cta: { label: "Accept invitation", url: d.acceptUrl },
    footnote: `This invitation expires in ${d.expiresInDays} days and can be used once.`,
  }),
  staff_invitation: (d) => ({
    subject: "Set up your dispatch dashboard account",
    heading: "You have been invited to the dispatch dashboard",
    paragraphs: [
      `${d.inviterName ? `${d.inviterName} invited you` : "You have been invited"} to join the internal dispatch dashboard as ${d.roleLabel.toLowerCase()}.`,
      "Use the button below to choose a password. Administrative accounts should also enable two-step verification.",
    ],
    cta: { label: "Set up account", url: d.acceptUrl },
    footnote: "This link can be used once. Ask an administrator for a new link if it has expired.",
  }),
  agreement_accepted: (d) => ({
    subject: `Agreement accepted: ${d.agreementTitle}`,
    heading: "Agreement accepted",
    paragraphs: [`${d.signerName} accepted the ${d.agreementTitle}. Keep this email for your records.`],
    details: [
      ["Agreement", d.agreementTitle],
      ["Version", d.version],
      ["Accepted", d.acceptedAt],
      ["Document fingerprint (SHA-256)", d.documentHash],
    ],
  }),
  missing_document_reminder: (d) => ({
    subject: "Documents needed to finish onboarding",
    heading: "A few documents are still needed",
    paragraphs: [`We still need the following for ${d.carrierName}:`, d.documents.join(", ")],
    cta: { label: "Upload documents", url: d.portalUrl },
  }),
  expiring_insurance_reminder: (d) => ({
    subject: d.daysRemaining < 0 ? `${d.documentLabel} has expired` : `${d.documentLabel} expires in ${d.daysRemaining} days`,
    heading: d.daysRemaining < 0 ? "Your document has expired" : "A document is expiring soon",
    paragraphs: [
      `Our records show the ${d.documentLabel.toLowerCase()} for ${d.carrierName} ${d.daysRemaining < 0 ? "expired" : "expires"} on ${d.expiresOn}.`,
      "Brokers require current insurance before a load can be booked. Please upload the renewed document.",
    ],
    cta: { label: "Upload updated document", url: d.portalUrl },
  }),
  proposed_load_review: (d) => ({
    subject: `Load ${d.reference} is waiting for your decision`,
    heading: "A load is ready for your review",
    paragraphs: [
      `We found a load for ${d.carrierName}. Nothing is booked until you approve it.`,
    ],
    details: [
      ["Reference", d.reference],
      ["Lane", d.lane],
      ["Pickup", d.pickupWindow],
      ["Rate", d.grossRate],
      ["Rate per loaded mile", d.ratePerMile],
    ],
    cta: { label: "Approve or reject", url: d.reviewUrl },
  }),
  load_status_update: (d) => ({
    subject: `Load ${d.reference}: ${d.statusLabel}`,
    heading: `Load ${d.reference} is ${d.statusLabel.toLowerCase()}`,
    paragraphs: [`${d.lane}`, ...(d.note ? [d.note] : [])],
    cta: { label: "View load", url: d.loadUrl },
  }),
  weekly_statement_ready: (d) => ({
    subject: `Weekly statement for ${d.periodLabel}`,
    heading: "Your weekly statement is ready",
    paragraphs: [`Here is the summary for ${d.carrierName}, ${d.periodLabel}. Your gross revenue is your business's revenue; the dispatch fee is what you owe us.`],
    details: [
      ["Completed loads", String(d.completedLoads)],
      ["Your gross load revenue", d.grossRevenue],
      ["Dispatch fee", d.dispatchFee],
      ["Amount due", d.amountDue],
    ],
    cta: { label: "View statement", url: d.statementUrl },
  }),
  invoice_due: (d) => ({
    subject: d.overdue ? `Invoice ${d.invoiceNumber} is past due` : `Invoice ${d.invoiceNumber} is due ${d.dueDate}`,
    heading: d.overdue ? "Invoice past due" : "Invoice reminder",
    paragraphs: [`This is a reminder about dispatch service invoice ${d.invoiceNumber} for ${d.carrierName}.`],
    details: [
      ["Amount due", d.amountDue],
      ["Due date", d.dueDate],
    ],
    cta: { label: "View and pay invoice", url: d.invoiceUrl },
  }),
  payment_received: (d) => ({
    subject: `Payment received for invoice ${d.invoiceNumber}`,
    heading: "Thank you — payment received",
    paragraphs: [`We received your payment for dispatch service invoice ${d.invoiceNumber}.`],
    details: [
      ["Amount", d.amount],
      ["Method", d.method],
      ["Received", d.receivedOn],
    ],
    cta: { label: "View invoice", url: d.invoiceUrl },
  }),
  support_request_confirmation: (d) => ({
    subject: `We received your request: ${d.subject}`,
    heading: "Support request received",
    paragraphs: [`Hi ${d.name}, we received your request "${d.subject}" and will follow up soon.`],
    details: [["Reference", d.reference]],
    cta: { label: "View in portal", url: d.portalUrl },
  }),
  support_request_update: (d) => ({
    subject: `Update on your request: ${d.subject}`,
    heading: "Your support request was updated",
    paragraphs: [`Hi ${d.name}, there is an update on "${d.subject}". Status: ${d.statusLabel}.`, d.message],
    cta: { label: "View in the portal", url: d.portalUrl },
  }),
  admin_new_application: (d) => ({
    subject: `New carrier application: ${d.legalName}`,
    heading: "New carrier application",
    paragraphs: ["A carrier submitted an application and is waiting for review."],
    details: [
      ["Carrier", d.legalName],
      ["Equipment", d.equipment],
      ["Trucks", d.truckCount],
    ],
    cta: { label: "Review application", url: d.reviewUrl },
  }),
  admin_support_request: (d) => ({
    subject: `Support request from ${d.carrierName}: ${d.subject}`,
    heading: "New support request",
    paragraphs: [`${d.carrierName} opened a ${d.category} request.`],
    cta: { label: "Open request", url: d.reviewUrl },
  }),
  daily_operations_summary: (d) => ({
    subject: `Daily operations summary — ${d.date}`,
    heading: `Operations summary for ${d.date}`,
    paragraphs: ["Carrier gross revenue and dispatch-company revenue are reported separately."],
    details: d.lines,
    cta: { label: "Open dashboard", url: d.dashboardUrl },
  }),
  contact_message: (d) => ({
    subject: `Website contact: ${d.topic}`,
    heading: "New website message",
    paragraphs: [d.message],
    details: [
      ["Topic", d.topic],
      ["Name", d.name],
      ["Email", d.email],
      ["Phone", d.phone],
    ],
  }),
};

export function buildTemplate<K extends TemplateKey>(
  key: K,
  data: TemplateData[K],
  override?: { subject?: string; intro?: string },
): EmailContent {
  const content = (TEMPLATES[key] as Builder<K>)(data);
  return {
    ...content,
    subject: override?.subject?.trim() || content.subject,
    paragraphs: override?.intro?.trim() ? [override.intro.trim(), ...content.paragraphs] : content.paragraphs,
  };
}

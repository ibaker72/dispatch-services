import { describe, expect, it } from "vitest";
import { business, businessConfigSchema, displayableAuthority, isPlaceholder, placeholderFields } from "@/config/business";
import { escapeHtml, renderEmail, safeHref } from "@/lib/email/layout";
import { TEMPLATES, TEMPLATE_LABELS, type TemplateKey, buildTemplate } from "@/lib/email/templates";
import { resolveEnv } from "@/lib/env";
import { signLocalToken, verifyLocalToken } from "@/lib/storage";

const brand = { brandName: "Test Dispatch", legalEntity: "Test Dispatch LLC", address: "1 Road, TX", supportEmail: "help@test.example", phone: "555-0100" };

const SAMPLE: { [K in TemplateKey]: Parameters<(typeof TEMPLATES)[K]>[0] } = {
  application_received: { contactName: "Pat" },
  application_resume_link: { contactName: "Pat", resumeUrl: "https://x.example/apply/resume?token=t", expiresOn: "Oct 22, 2026" },
  application_status_changed: { contactName: "Pat", statusLabel: "Under review" },
  information_requested: { contactName: "Pat", request: "Upload a current COI", resumeUrl: "https://x.example/apply/resume?t=1" },
  application_approved: { contactName: "Pat", carrierName: "Pat Hauling", nextSteps: "Watch for the portal invitation." },
  portal_invitation: { carrierName: "Pat Hauling", acceptUrl: "https://x.example/invite", expiresInDays: 7, role: "owner" },
  staff_invitation: { inviterName: "Alex Admin", roleLabel: "Dispatcher", acceptUrl: "https://x.example/auth/confirm" },
  agreement_accepted: { signerName: "Pat", agreementTitle: "Dispatch Service Agreement", version: "1.0", acceptedAt: "Sep 22, 2026", documentHash: "a".repeat(64) },
  missing_document_reminder: { carrierName: "Pat Hauling", documents: ["W-9"], portalUrl: "https://x.example/portal" },
  expiring_insurance_reminder: { carrierName: "Pat Hauling", documentLabel: "Certificate of insurance", expiresOn: "Oct 1, 2026", daysRemaining: 9, portalUrl: "https://x.example/portal" },
  proposed_load_review: { carrierName: "Pat Hauling", reference: "LD-1", lane: "Dallas, TX → Atlanta, GA", pickupWindow: "Sep 23", grossRate: "$2,500.00", ratePerMile: "$2.50/mi", reviewUrl: "https://x.example/l" },
  load_status_update: { carrierName: "Pat Hauling", reference: "LD-1", lane: "Dallas, TX → Atlanta, GA", statusLabel: "Delivered", loadUrl: "https://x.example/l" },
  weekly_statement_ready: { carrierName: "Pat Hauling", periodLabel: "Sep 14–20, 2026", completedLoads: 2, grossRevenue: "$4,300.00", dispatchFee: "$308.00", amountDue: "$308.00", statementUrl: "https://x.example/s" },
  invoice_due: { carrierName: "Pat Hauling", invoiceNumber: "INV-1", amountDue: "$308.00", dueDate: "Sep 29, 2026", overdue: false, invoiceUrl: "https://x.example/i" },
  payment_received: { carrierName: "Pat Hauling", invoiceNumber: "INV-1", amount: "$308.00", method: "ACH", receivedOn: "Sep 25, 2026", invoiceUrl: "https://x.example/i" },
  support_request_confirmation: { name: "Pat", subject: "Question", reference: "SR-1", portalUrl: "https://x.example/p" },
  support_request_update: { name: "Pat", subject: "Detention question", statusLabel: "Resolved", message: "We added the detention to your load.", portalUrl: "https://x.example/portal/support" },
  admin_new_application: { legalName: "Pat Hauling", equipment: "Car hauler", truckCount: "2", reviewUrl: "https://x.example/a" },
  admin_support_request: { carrierName: "Pat Hauling", category: "billing", subject: "Question", reviewUrl: "https://x.example/a" },
  daily_operations_summary: { date: "Sep 22, 2026", lines: [["Loads booked", "3"]], dashboardUrl: "https://x.example/d" },
  contact_message: { topic: "Dispatch", name: "Pat", email: "pat@x.example", phone: "555", message: "Hello" },
};

describe("email templates", () => {
  it("covers every required template", () => {
    const required = [
      "application_received",
      "application_status_changed",
      "information_requested",
      "application_approved",
      "portal_invitation",
      "agreement_accepted",
      "missing_document_reminder",
      "expiring_insurance_reminder",
      "proposed_load_review",
      "load_status_update",
      "weekly_statement_ready",
      "invoice_due",
      "payment_received",
      "support_request_confirmation",
    ];
    for (const key of required) expect(Object.keys(TEMPLATES)).toContain(key);
    expect(Object.keys(TEMPLATE_LABELS).sort()).toEqual(Object.keys(TEMPLATES).sort());
  });

  it.each(Object.keys(SAMPLE) as TemplateKey[])("%s renders HTML with a useful plain-text fallback", (key) => {
    const content = buildTemplate(key, SAMPLE[key] as never);
    const { html, text, subject } = renderEmail(content, brand);
    expect(subject.length).toBeGreaterThan(5);
    expect(html).toContain("<!doctype html>");
    expect(text).toContain(content.heading);
    for (const paragraph of content.paragraphs) expect(text).toContain(paragraph);
    if (content.cta) expect(text).toContain(content.cta.url);
    expect(text).toContain("We are not a freight broker or motor carrier.");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("escapes untrusted values and blocks non-http links", () => {
    const { html } = renderEmail(
      { subject: "x", heading: "<img src=x onerror=alert(1)>", paragraphs: ["a & b"], cta: { label: "Go", url: "javascript:alert(1)" } },
      brand,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    expect(html).toContain('href="#"');
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
    expect(safeHref("https://ok.example/x")).toBe("https://ok.example/x");
  });

  it("applies admin subject/intro overrides", () => {
    const content = buildTemplate("application_received", { contactName: "Pat" }, { subject: "Got it!", intro: "Hello from the team." });
    expect(content.subject).toBe("Got it!");
    expect(content.paragraphs[0]).toBe("Hello from the team.");
  });
});

describe("business configuration", () => {
  it("is valid and uses the required defaults", () => {
    expect(() => businessConfigSchema.parse(business)).not.toThrow();
    expect(business.pricing.defaultPercentage).toBe("0.07");
    expect(business.pricing.flatWeeklyPerTruck).toBe("300.00");
    expect(business.equipment.primary).toBe("car_hauler");
    expect(business.equipment.secondary).toEqual(["hotshot", "box_truck", "dry_van"]);
    expect(business.serviceArea).toBe("United States");
    expect(business.leaseOn).toEqual({ status: "disabled", waitlistEnabled: true });
  });

  it("does not claim operating authority or display USDOT/MC numbers without real values", () => {
    expect(business.authority).toEqual({ hasOperatingAuthority: false, usdotNumber: null, mcNumber: null });
    expect(displayableAuthority()).toBeNull();
    expect(displayableAuthority({ ...business, authority: { hasOperatingAuthority: true, usdotNumber: "1234567", mcNumber: null } })).toBeNull();
    expect(displayableAuthority({ ...business, authority: { hasOperatingAuthority: true, usdotNumber: "1234567", mcNumber: "765432" } })).toEqual({
      usdot: "1234567",
      mc: "765432",
    });
  });

  it("reports placeholder fields to administrators", () => {
    expect(isPlaceholder("[BUSINESS NAME]")).toBe(true);
    expect(isPlaceholder("Acme Dispatch")).toBe(false);
    expect(placeholderFields()).toEqual(["brandName", "legalEntity", "email", "phone", "address", "websiteUrl"]);
  });
});

describe("environment validation", () => {
  it("falls back to development adapters outside production", () => {
    const env = resolveEnv({ APP_ENV: "development" });
    expect(env.emailDriver).toBe("console");
    expect(env.paymentsDriver).toBe("manual");
    expect(env.LEASE_ON_OPERATIONS_ENABLED).toBe(false);
  });

  it("refuses development-only adapters and missing secrets in production", () => {
    expect(() => resolveEnv({ APP_ENV: "production", STORAGE_DRIVER: "local" })).toThrow(/STORAGE_DRIVER=local/);
    expect(() => resolveEnv({ APP_ENV: "production", PAYMENTS_DRIVER: "mock", CRON_SECRET: "x", RATE_LIMIT_SALT: "y" })).toThrow(/mock/);
    expect(() => resolveEnv({ APP_ENV: "production", EMAIL_DRIVER: "outbox", CRON_SECRET: "x", RATE_LIMIT_SALT: "y" })).toThrow(/outbox/);
    expect(() => resolveEnv({ APP_ENV: "production", CRON_SECRET: "x", RATE_LIMIT_SALT: "y" })).toThrow(/EMAIL_DRIVER=console/);
    expect(() => resolveEnv({ APP_ENV: "production", RESEND_API_KEY: "re_x", RATE_LIMIT_SALT: "y" })).toThrow(/CRON_SECRET/);
    expect(() =>
      resolveEnv({ APP_ENV: "production", RESEND_API_KEY: "re_x", STRIPE_SECRET_KEY: "sk_test_x", CRON_SECRET: "x", RATE_LIMIT_SALT: "y" }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("keeps lease-on disabled unless explicitly enabled", () => {
    expect(resolveEnv({ LEASE_ON_OPERATIONS_ENABLED: "false" }).LEASE_ON_OPERATIONS_ENABLED).toBe(false);
    expect(resolveEnv({ LEASE_ON_OPERATIONS_ENABLED: "yes" }).LEASE_ON_OPERATIONS_ENABLED).toBe(false);
    expect(resolveEnv({ LEASE_ON_OPERATIONS_ENABLED: "true" }).LEASE_ON_OPERATIONS_ENABLED).toBe(true);
  });
});

describe("local storage signed URLs", () => {
  it("verify signature, operation, path and expiry", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signLocalToken("s3cret", "download", "carriers/a/b/c.pdf", exp, "c.pdf");
    expect(verifyLocalToken("s3cret", "download", "carriers/a/b/c.pdf", exp, sig, "c.pdf")).toBe(true);
    expect(verifyLocalToken("s3cret", "upload", "carriers/a/b/c.pdf", exp, sig, "c.pdf")).toBe(false);
    expect(verifyLocalToken("s3cret", "download", "carriers/x/b/c.pdf", exp, sig, "c.pdf")).toBe(false);
    expect(verifyLocalToken("other", "download", "carriers/a/b/c.pdf", exp, sig, "c.pdf")).toBe(false);
    expect(verifyLocalToken("s3cret", "download", "carriers/a/b/c.pdf", exp, sig, "c.pdf", (exp + 1) * 1000)).toBe(false);
  });
});

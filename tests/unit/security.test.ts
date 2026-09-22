import { describe, expect, it } from "vitest";
import { fleetSizeBucket, sanitizeEventProperties, sanitizeUrl } from "@/lib/analytics/events";
import { scrubEvent, scrubValue } from "@/lib/observability/scrub";
import { buildCsp } from "@/lib/security/csp";
import { csvCell, toCsv } from "@/lib/security/csv";
import { sanitizeFilename, sniffMimeType, validateUploadMetadata, verifyStoredFile } from "@/lib/security/files";
import { safeRedirectPath } from "@/lib/security/redirect";
import { clientIp, isSameOriginRequest } from "@/lib/security/request";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("safe redirects", () => {
  it.each([
    ["/portal", "/portal"],
    ["/dashboard/loads?status=booked", "/dashboard/loads?status=booked"],
    ["https://example.com/portal/invoices", "/portal/invoices"],
  ])("allows %s", (input, expected) => {
    expect(safeRedirectPath(input, "/", "https://example.com")).toBe(expected);
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "%2F%2Fevil.example",
    "javascript:alert(1)",
    "data:text/html,hi",
    "portal",
    "/portal\u0000",
    "/auth/confirm?token_hash=abc",
    "/api/stripe/webhook",
    "",
  ])("rejects %s", (input) => {
    expect(safeRedirectPath(input, "/fallback", "https://example.com")).toBe("/fallback");
  });
});

describe("CSV formula injection", () => {
  it.each(["=HYPERLINK(\"http://x\")", "+cmd", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])("neutralizes %j", (value) => {
    expect(csvCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("keeps plain numbers intact, including negatives", () => {
    expect(csvCell("-25.00")).toBe("-25.00");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes separators and escapes quotes", () => {
    expect(csvCell('Smith, "Jr"')).toBe('"Smith, ""Jr"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });

  it("builds RFC 4180 output with a BOM", () => {
    expect(toCsv(["a", "b"], [["=1+1", "ok"]])).toBe("﻿a,b\r\n'=1+1,ok\r\n");
  });
});

describe("upload validation", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

  it("sniffs real file types from magic bytes", () => {
    expect(sniffMimeType(pdf)).toBe("application/pdf");
    expect(sniffMimeType(png)).toBe("image/png");
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMimeType(exe)).toBeNull();
  });

  it("rejects disallowed types, empty and oversized files, and mismatched extensions", () => {
    expect(validateUploadMetadata({ filename: "coi.pdf", mimeType: "application/pdf", size: 1000 }).ok).toBe(true);
    expect(validateUploadMetadata({ filename: "run.exe", mimeType: "application/x-msdownload", size: 1000 }).ok).toBe(false);
    expect(validateUploadMetadata({ filename: "big.pdf", mimeType: "application/pdf", size: 11 * 1024 * 1024 }).ok).toBe(false);
    expect(validateUploadMetadata({ filename: "empty.pdf", mimeType: "application/pdf", size: 0 }).ok).toBe(false);
    expect(validateUploadMetadata({ filename: "coi.png", mimeType: "application/pdf", size: 10 }).ok).toBe(false);
  });

  it("rejects stored bytes that do not match the declared type", () => {
    expect(verifyStoredFile(pdf, "application/pdf")).toEqual({ ok: true });
    expect(verifyStoredFile(exe, "application/pdf").ok).toBe(false);
    expect(verifyStoredFile(png, "application/pdf").ok).toBe(false);
  });

  it("sanitizes filenames and forces the extension", () => {
    expect(sanitizeFilename("../../etc/passwd", "application/pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename("My COI (2026).PDF", "application/pdf")).toBe("My-COI-2026.pdf");
    expect(sanitizeFilename("<script>.pdf", "application/pdf")).toBe("script.pdf");
  });
});

describe("request helpers", () => {
  it("accepts same-origin requests only", () => {
    expect(isSameOriginRequest(headers({ origin: "https://app.example", host: "app.example" }))).toBe(true);
    expect(isSameOriginRequest(headers({ origin: "https://evil.example", host: "app.example" }))).toBe(false);
    expect(isSameOriginRequest(headers({ host: "app.example" }))).toBe(false);
    expect(isSameOriginRequest(headers({ origin: "null", host: "app.example" }))).toBe(false);
  });

  it("extracts a well-formed client IP", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(headers({ "x-forwarded-for": "<script>" }))).toBeNull();
  });
});

describe("analytics privacy", () => {
  it("drops properties that are not in the catalog", () => {
    expect(sanitizeEventProperties("application_submitted", { equipment_type: "car_hauler", email: "a@b.co", mc_number: "123456" })).toEqual({
      equipment_type: "car_hauler",
    });
  });

  it("drops values that look like PII or financial data even in allowed keys", () => {
    for (const value of ["pat@example.com", "1234567", "1HGCM82633A004352", "coi.pdf", "$2500", "Pat Smith"]) {
      expect(sanitizeEventProperties("cta_clicked", { cta: value })).toEqual({});
    }
    expect(sanitizeEventProperties("application_step_completed", { step: 3, step_key: "equipment" })).toEqual({ step: 3, step_key: "equipment" });
    expect(sanitizeEventProperties("application_step_completed", { step: 12345 })).toEqual({});
  });

  it("buckets fleet size and strips URL queries and record ids", () => {
    expect(fleetSizeBucket(7)).toBe("4_10");
    expect(sanitizeUrl("https://x.example/portal/loads/0b6f1c2e-1111-4222-8333-944445555666?token=abc#x")).toBe(
      "https://x.example/portal/loads/:id",
    );
  });
});

describe("error-monitoring scrubbing", () => {
  it("redacts sensitive keys and values", () => {
    expect(scrubValue({ email: "a@b.co", mc_number: "123456", note: "call 555-123-4567 or a@b.co", count: 3 })).toEqual({
      email: "[redacted]",
      mc_number: "[redacted]",
      note: "call [redacted] or [redacted]",
      count: 3,
    });
  });

  it("strips cookies, auth headers and query strings from events", () => {
    const event = scrubEvent({
      request: {
        url: "https://x.example/auth/confirm?token_hash=secret",
        cookies: "sb-access-token=abc",
        headers: { authorization: "Bearer eyJ.a.b", cookie: "x", "content-type": "text/html" },
        data: { password: "hunter2" },
      },
      user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4" },
      message: "failed for pat@example.com",
    });
    expect(event.request).toEqual({ url: "https://x.example/auth/confirm", headers: { "content-type": "text/html" } });
    expect(event.user).toEqual({ id: "u1" });
    expect(event.message).toBe("failed for [redacted]");
  });
});

describe("content security policy", () => {
  it("uses nonces and forbids framing, plugins and inline script in production", () => {
    const csp = buildCsp({ nonce: "abc123", isDev: false, supabaseUrl: "https://proj.supabase.co" });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' https://proj.supabase.co");
    expect(csp).toContain("upgrade-insecure-requests");
  });
});

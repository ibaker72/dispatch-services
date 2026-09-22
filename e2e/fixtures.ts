import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared fixtures. Every test fails if the browser logs a console error or an
 * uncaught exception — a quality gate for primary workflows.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(err.message));
      await use(errors);
      expect(errors, `console errors on ${page.url()}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const DEMO = {
  admin: { email: "admin@demo.example", password: "DemoAdmin!2026" },
  dispatcher: { email: "dispatcher@demo.example", password: "DemoDispatch!2026" },
  ownerA: { email: "owner@northstar-demo.example", password: "DemoCarrierA!2026" },
  ownerB: { email: "owner@bluebonnet-demo.example", password: "DemoCarrierB!2026" },
};

export async function login(page: Page, who: { email: string; password: string }, next?: string) {
  await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

function outboxDir() {
  return process.env.EMAIL_DEV_OUTBOX_DIR ?? path.join(process.cwd(), ".local-stack", "outbox");
}

/** Waits for an email in the development outbox and returns it. */
export async function waitForEmail(match: { to: string; subject?: RegExp }, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dir = outboxDir();
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).sort().reverse();
      for (const f of files) {
        const msg = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { to: string; subject: string; text: string; html: string };
        if (msg.to === match.to && (!match.subject || match.subject.test(msg.subject))) return msg;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`email to ${match.to} not found`);
}

export function linkFrom(text: string, contains: string): string {
  const link = text.match(/https?:\/\/\S+/g)?.find((l) => l.includes(contains));
  if (!link) throw new Error(`no link containing ${contains}`);
  return link;
}

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}@e2e.example`;
}

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DEMO, expect, login, test } from "./fixtures";

/**
 * Automated WCAG 2.1 AA checks (axe-core) on primary pages. Serious and
 * critical violations fail the build; the full report is attached on failure.
 */
async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`),
    `accessibility violations on ${path}`,
  ).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, `horizontal overflow on ${path}`).toBe(false);
}

const PUBLIC_PAGES = ["/", "/dispatch-services", "/car-hauler-dispatch", "/pricing", "/how-it-works", "/apply", "/contact", "/login", "/lease-on-waitlist", "/dispatch-disclosure"];

test.describe("accessibility @mobile", () => {
  for (const path of PUBLIC_PAGES) {
    test(`public page ${path}`, async ({ page }) => {
      await audit(page, path);
    });
  }

  test("carrier portal pages", async ({ page }) => {
    await login(page, DEMO.ownerA);
    for (const path of ["/portal", "/portal/loads", "/portal/billing", "/portal/documents", "/portal/onboarding", "/portal/account"]) {
      await audit(page, path);
    }
  });

  test("dispatch dashboard pages", async ({ page }) => {
    await login(page, DEMO.admin);
    for (const path of ["/dashboard", "/dashboard/applications?view=active", "/dashboard/carriers", "/dashboard/loads", "/dashboard/loads/new", "/dashboard/billing", "/dashboard/settings"]) {
      await audit(page, path);
    }
  });
});

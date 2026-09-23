import { type Page, expect } from "@playwright/test";
import { MINIMAL_PDF } from "./fixtures";

/** Completes and submits the public carrier application (shared by several specs). */
export async function completeApplication(page: Page, opts: { email: string; legalName: string }) {
  await page.goto("/apply");
  await page.getByRole("button", { name: "Start my application" }).click();

  // 1. Contact
  await expect(page.getByRole("heading", { name: "Contact information" })).toBeVisible();
  await page.getByLabel("Full name").fill("Casey Applicant");
  await page.getByLabel("Email").fill(opts.email);
  await page.getByLabel("Phone").fill("(555) 010-3344");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 2. Business and authority
  await expect(page.getByRole("heading", { name: "Business and authority" })).toBeVisible();
  await page.getByLabel("Legal company name").fill(opts.legalName);
  await page.getByLabel("MC number").fill("MC-0000123");
  await page.getByLabel("USDOT number").fill("0000456");
  await page.getByLabel("EIN — last four digits only").fill("1234");
  await page.getByLabel("Years in business").fill("2");
  await page.getByLabel("Authority activation date").fill("2024-02-01");
  await page.getByLabel("Street address").fill("1 Test Road");
  await page.getByLabel("City").fill("Tulsa");
  await page.getByLabel("State").selectOption("OK");
  await page.getByLabel("ZIP code").fill("74103");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 3. Equipment
  await expect(page.getByRole("heading", { name: "Equipment", exact: true })).toBeVisible();
  await page.getByLabel("Primary equipment").selectOption("car_hauler");
  await page.getByLabel("Number of trucks").fill("1");
  await page.getByLabel("Unit number").fill("T-1");
  await page.getByLabel("Vehicles it can carry").fill("3");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 4. Drivers
  await expect(page.getByRole("heading", { name: "Drivers" })).toBeVisible();
  await page.getByLabel("Full name").fill("Casey Applicant");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 5. Lanes
  await expect(page.getByRole("heading", { name: "Lanes and operating regions" })).toBeVisible();
  await page.getByLabel("Home base city").fill("Tulsa");
  await page.getByLabel("Home base state").selectOption("OK");
  await page.getByText("Choose states").first().click();
  await page.getByRole("checkbox", { name: "Texas" }).first().check();
  await page.getByRole("checkbox", { name: "Oklahoma" }).first().check();
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 6. Preferences
  await expect(page.getByRole("heading", { name: "Revenue and scheduling preferences" })).toBeVisible();
  await page.getByLabel("Minimum rate per loaded mile ($)").fill("2.25");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 7. Factoring
  await expect(page.getByRole("heading", { name: "Factoring" })).toBeVisible();
  await page.getByLabel("I use broker quick pay").check();
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 8. Documents
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  const nextYear = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Insurance expiration date").fill(nextYear);
  for (const [label, name] of [
    ["W-9", "w9.pdf"],
    ["Certificate of insurance", "coi.pdf"],
    ["Operating authority", "authority.pdf"],
  ] as const) {
    await page.getByLabel(`Upload ${label}`, { exact: false }).first().setInputFiles({ name, mimeType: "application/pdf", buffer: MINIMAL_PDF });
    await expect(page.getByText(`${name} uploaded.`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 9. Review and submit
  await expect(page.getByRole("heading", { name: "Review and submit" })).toBeVisible();
  await page.getByLabel(/information in this application is accurate/).check();
  await page.getByLabel(/authorize you to verify/).check();
  await page.getByLabel(/dispatch relationship disclosure/).check();
  await page.getByLabel(/terms of service/).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("we received your application", { exact: false })).toBeVisible();
}

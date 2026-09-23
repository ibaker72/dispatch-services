import { expect, test, uniqueEmail, waitForEmail } from "./fixtures";
import { completeApplication } from "./flows";

/**
 * Public carrier application: nine steps with autosave, document uploads to
 * private storage, strict validation and submission with confirmation email.
 */

test.describe("carrier application", () => {
  test("a carrier can complete and submit the application", async ({ page }) => {
    const email = uniqueEmail("applicant");
    await completeApplication(page, { email, legalName: `E2E Hauling ${Date.now()} LLC` });
    const confirmation = await waitForEmail({ to: email, subject: /received your dispatch application/ });
    expect(confirmation.text).toContain("Nothing is booked on your behalf");
  });

  test("progress is autosaved and restored after reload", async ({ page }) => {
    await page.goto("/apply");
    await page.getByRole("button", { name: "Start my application" }).click();
    await page.getByLabel("Full name").fill("Autosave Person");
    await expect(page.getByText("Progress saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Full name")).toHaveValue("Autosave Person");
  });

  test("validation errors are announced and full EINs are rejected", async ({ page }) => {
    await page.goto("/apply");
    await page.getByRole("button", { name: "Start my application" }).click();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByText("Full name is required")).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Full name").fill("Pat Example");
    await page.getByLabel("Email").fill(uniqueEmail("ein"));
    await page.getByLabel("Phone").fill("5550103344");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.getByLabel("EIN — last four digits only").fill("12-3456789");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByText("Enter only the last four digits of your EIN")).toBeVisible();
  });
});

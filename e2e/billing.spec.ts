import { DEMO, expect, expectNoConsoleErrors, login, signedInPage, test, waitForEmail } from "./fixtures";

/** Admin issues a dispatch-service invoice; the carrier owner pays it online (mock checkout → verified webhook). */
test("a carrier pays a dispatch service invoice online", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const amount = `${40 + Math.floor(Math.random() * 50)}.${String(Math.floor(Math.random() * 90) + 10)}`;
  await login(page, DEMO.admin, "/dashboard/billing?tab=invoices");
  await page.goto("/dashboard/billing?tab=invoices");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Manual invoice" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Carrier").selectOption({ label: "Northstar Auto Transport LLC (Demo)" });
  await dialog.getByLabel("Line description").fill("Dispatch services — E2E adjustment");
  await dialog.getByLabel("Amount ($)").fill(amount);
  await dialog.getByRole("button", { name: "Create and open invoice" }).click();
  await expect(dialog).toBeHidden();

  const owner = await signedInPage(browser, DEMO.ownerA);
  await owner.goto("/portal/billing");
  await owner.getByRole("row", { name: new RegExp(`\\$${amount.replace(".", "\\.")}`) }).first().getByRole("link").click();
  await owner.getByRole("button", { name: new RegExp(`Pay \\$${amount.replace(".", "\\.")} online`) }).click();
  await owner.waitForURL(/\/dev\/mock-checkout/);
  await owner.getByRole("button", { name: "Pay (test)" }).click();
  await owner.waitForURL(/payment=success/);
  await owner.reload();
  await expect(owner.getByText("Paid", { exact: true }).first()).toBeVisible();
  await waitForEmail({ to: DEMO.ownerA.email, subject: /Payment received/ });
  expectNoConsoleErrors(owner);
});

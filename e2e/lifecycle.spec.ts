import { DEMO, expect, expectNoConsoleErrors, linkFrom, signedInPage, test, uniqueEmail, waitForEmail } from "./fixtures";
import { completeApplication } from "./flows";

/**
 * Application → approval → portal invitation → agreements → document review →
 * authority verification → activation. Exercises the real database guards:
 * activation is refused until every onboarding step is complete.
 */
test("a carrier goes from application to active dispatch service", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail("lifecycle");
  const legalName = `Lifecycle Hauling ${Date.now()} LLC`;
  await completeApplication(page, { email, legalName });

  // Admin approves and assigns a dispatcher; the owner gets a portal invitation.
  const admin = await signedInPage(browser, DEMO.admin, "/dashboard/applications");
  await admin.goto("/dashboard/applications");
  await admin.getByRole("link", { name: legalName }).click();
  await admin.getByRole("button", { name: "Approve" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("Primary dispatcher").selectOption({ label: "Dana Dispatcher (Demo)" });
  await dialog.getByRole("button", { name: "Approve and create carrier" }).click();
  await admin.waitForURL(/\/dashboard\/carriers\/[0-9a-f-]{36}$/);
  const carrierUrl = admin.url();
  await expect(admin.getByRole("heading", { name: legalName })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Activate dispatch service" })).toBeVisible();

  // Owner accepts the invitation from the email.
  const invitation = await waitForEmail({ to: email, subject: /portal account/ });
  const owner = await (await browser.newContext()).newPage();
  await owner.goto(linkFrom(invitation.text, "/auth/confirm"));
  await owner.waitForURL(/\/invite\/accept/);
  await owner.getByLabel("Your name").fill("Casey Owner");
  await owner.getByLabel(/^Password/).fill("LifecycleOwner!2026");
  await owner.getByLabel("Confirm password").fill("LifecycleOwner!2026");
  await owner.getByRole("button", { name: "Continue" }).click();
  await owner.waitForURL(/\/portal\/onboarding/);

  // Activation is refused while steps remain.
  await admin.reload();
  await admin.getByRole("button", { name: "Activate dispatch service" }).click();
  await expect(admin.getByText("Onboarding is not complete yet")).toBeVisible();

  // Owner accepts every required agreement (acceptance evidence is recorded server-side).
  const acceptButtons = owner.getByRole("button", { name: "Accept agreement" });
  const count = await acceptButtons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const form = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Accept agreement" }) }).first();
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Accept agreement" }).click();
    await expect(owner.getByText("Accepted by Casey Owner").nth(i)).toBeVisible();
  }
  await waitForEmail({ to: email, subject: /Agreement accepted/ });

  // Admin reviews the application documents and verifies authority.
  await admin.goto(`${carrierUrl}?tab=documents`);
  for (let remaining = 3; remaining > 0; remaining--) {
    // Wait for the refresh after the previous review before opening the next one.
    await expect(admin.getByRole("button", { name: "Review" })).toHaveCount(remaining);
    await admin.getByRole("button", { name: "Review" }).first().click();
    const review = admin.getByRole("dialog");
    const expires = review.getByLabel("Expiration date");
    if ((await expires.inputValue()) === "") await expires.fill(new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10));
    await review.getByRole("button", { name: "Accept document" }).click();
    await expect(review).toBeHidden();
  }
  await expect(admin.getByRole("button", { name: "Review" })).toHaveCount(0);

  await admin.goto(carrierUrl);
  await admin.getByRole("button", { name: "Record verification" }).click();
  const verify = admin.getByRole("dialog");
  await verify.getByLabel("Result").selectOption("verified");
  await verify.getByLabel("What you checked").fill("E2E: authority and insurance confirmed in FMCSA records.");
  await verify.getByRole("button", { name: "Save verification" }).click();
  await expect(verify).toBeHidden();

  await admin.getByRole("button", { name: "Activate dispatch service" }).click();
  await expect(admin.getByRole("button", { name: "Deactivate" })).toBeVisible();

  await owner.goto("/portal");
  await expect(owner.getByText("Your account is in onboarding")).toHaveCount(0);
  expectNoConsoleErrors(admin);
});

import { DEMO, expect, expectNoConsoleErrors, expectNotFound, login, signedInPage, test } from "./fixtures";

/**
 * Dispatcher proposes a load; only the carrier owner can approve it; booking
 * requires the approval plus a specific truck and driver.
 */
test("a proposed load is approved by the carrier and booked by the dispatcher", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const broker = `E2E Broker ${Date.now()}`;
  await login(page, DEMO.dispatcher);

  await page.goto("/dashboard/loads/new");
  // Interact only after hydration; React Hook Form applies default values on mount.
  await page.waitForLoadState("networkidle");
  await page.locator("#carrier_id").selectOption({ label: "Northstar Auto Transport LLC (Demo)" });
  await page.locator("#broker_name").fill(broker);
  await page.locator("#gross_rate").fill("2450.00");
  await page.locator("#loaded_miles").fill("700");
  await page.locator("#deadhead_miles").fill("40");
  await page.locator("#stops-0-city").fill("Dallas");
  await page.locator("#stops-0-state").selectOption("TX");
  await page.locator("#stops-1-city").fill("Nashville");
  await page.locator("#stops-1-state").selectOption("TN");
  await page.getByRole("button", { name: "Create load" }).click();
  await page.waitForURL(/\/dashboard\/loads\/[0-9a-f-]{36}$/);
  const loadPath = new URL(page.url()).pathname.replace("/dashboard", "/portal");
  await page.getByRole("button", { name: "Send to carrier for approval" }).click();
  await expect(page.getByText("Waiting for the carrier's decision")).toBeVisible();

  // Booking is impossible before the carrier approves.
  await expect(page.getByRole("button", { name: "Book load" })).toHaveCount(0);

  // Another carrier cannot even see the load.
  const other = await signedInPage(browser, DEMO.ownerB);
  await expectNotFound(other, loadPath, broker);

  // The owner approves in the portal.
  const owner = await signedInPage(browser, DEMO.ownerA);
  await owner.goto(loadPath);
  await owner.getByRole("button", { name: "Approve load" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByText("You approved").first()).toBeVisible();

  // Dispatcher assigns equipment and books.
  await page.reload();
  await expect(page.getByText("Assign a specific truck.")).toBeVisible();
  await page.getByRole("button", { name: "Assign" }).click();
  const assign = page.getByRole("dialog");
  await assign.getByLabel("Truck").selectOption({ index: 1 });
  await assign.getByLabel("Driver").selectOption({ index: 1 });
  await assign.getByRole("button", { name: "Save assignment" }).click();
  await expect(assign).toBeHidden();
  await page.getByRole("button", { name: "Book load" }).click();
  await expect(page.getByRole("button", { name: "Mark dispatched" })).toBeVisible();
  await expect(page.getByText("Booked").first()).toBeVisible();
  expectNoConsoleErrors(owner);
  expectNoConsoleErrors(other);
});

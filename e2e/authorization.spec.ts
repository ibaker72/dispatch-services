import pg from "pg";
import { DEMO, expect, expectNotFound, login, test } from "./fixtures";
import { loadLocalStackEnv } from "../tests/support/env";

/**
 * Negative authorization checks through the real app: route guards redirect,
 * and data the user may not see returns 404 (RLS), never another tenant's data.
 */
async function idOf(sql: string): Promise<string> {
  loadLocalStackEnv();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(sql);
    if (!rows[0]) throw new Error(`fixture not found: ${sql}`);
    return rows[0].id;
  } finally {
    await client.end();
  }
}

test.describe("authorization", () => {
  test("anonymous visitors are sent to sign in", async ({ page }) => {
    await page.goto("/dashboard/carriers");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await page.goto("/portal/billing");
    await expect(page).toHaveURL(/\/login/);
  });

  test("carrier users cannot open the dispatch dashboard or another carrier's records", async ({ page, request }) => {
    const bLoad = await idOf(`select l.id from public.loads l join public.carriers c on c.id = l.carrier_id where c.legal_name like 'Bluebonnet%' and l.status <> 'opportunity' limit 1`);
    const bInvoice = await idOf(`select i.id from public.invoices i join public.carriers c on c.id = i.carrier_id where c.legal_name like 'Bluebonnet%' limit 1`);
    const bDocument = await idOf(`select d.id from public.documents d join public.carriers c on c.id = d.carrier_id where c.legal_name like 'Bluebonnet%' and d.deleted_at is null limit 1`);
    const aOpportunity = await idOf(`select l.id from public.loads l join public.carriers c on c.id = l.carrier_id where c.legal_name like 'Northstar%' and l.status = 'opportunity' limit 1`);

    await login(page, DEMO.ownerA);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/portal/);
    await expectNotFound(page, `/portal/loads/${bLoad}`);
    await expectNotFound(page, `/portal/billing/invoices/${bInvoice}`);
    // Dispatcher opportunities are not shown to carriers until proposed.
    await expectNotFound(page, `/portal/loads/${aOpportunity}`);
    const download = await page.request.get(`/api/documents/${bDocument}/download`, { maxRedirects: 0 });
    expect(download.status()).toBe(404);
    const exportRes = await page.request.get("/api/exports/loads");
    expect(exportRes.status()).toBe(404);
    const unauthenticated = await request.get("/api/cron/invoice-reminders");
    expect(unauthenticated.status()).toBe(401);
  });

  test("dispatchers see only assigned carriers and cannot open admin areas", async ({ page }) => {
    const bCarrier = await idOf(`select id from public.carriers where legal_name like 'Bluebonnet%'`);
    await login(page, DEMO.dispatcher);
    await expectNotFound(page, `/dashboard/carriers/${bCarrier}`, "Bluebonnet");
    await page.goto("/dashboard/settings");
    await expect(page).toHaveURL(/\/dashboard\?error=forbidden/);
    await page.goto("/dashboard/audit");
    await expect(page).toHaveURL(/\/dashboard\?error=forbidden/);
    const audit = await page.request.get("/api/exports/audit");
    expect(audit.status()).toBe(404);
  });
});

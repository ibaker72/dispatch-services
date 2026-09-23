/**
 * Scheduled jobs: one run per run key, retries after failure, and handlers
 * that never send the same reminder twice.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpenInvoice } from "./support/fixtures";
import { closePool, commitTx, getPool } from "../db/support/harness";
import { type World, createWorld, insertDocument } from "../db/support/world";
import { addDays } from "@/lib/domain/dates";
import { businessToday, documentExpirationReminders, invoiceReminders } from "@/lib/jobs/handlers";
import { runJob } from "@/lib/jobs/runner";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

const commsWith = async (prefix: string) =>
  Number((await getPool().query(`select count(*) from public.communications where dedupe_key like $1`, [`${prefix}%`])).rows[0].count);

describe("job runner", () => {
  it("runs a job once per run key", async () => {
    const key = `test-${randomUUID()}`;
    let calls = 0;
    const first = await runJob("integration-test", key, "manual", async () => ({ calls: ++calls }));
    const second = await runJob("integration-test", key, "manual", async () => ({ calls: ++calls }));
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("skipped");
    expect(calls).toBe(1);
  });

  it("records failures and retries them on the next invocation", async () => {
    const key = `test-${randomUUID()}`;
    const failed = await runJob("integration-test", key, "manual", async () => {
      throw new Error("upstream unavailable");
    });
    expect(failed).toMatchObject({ status: "failed", error: "upstream unavailable" });
    const retried = await runJob("integration-test", key, "manual", async () => ({ ok: true }));
    expect(retried.status).toBe("succeeded");
    const { rows } = await getPool().query(`select status, attempts from public.job_runs where run_key = $1`, [`integration-test:${key}`]);
    expect(rows[0]).toEqual({ status: "succeeded", attempts: 2 });
  });
});

describe("reminder handlers", () => {
  it("sends one invoice reminder before the due date, however often the job runs", async () => {
    const invoiceId = await createOpenInvoice(w.A, "75.00", 2);
    const today = await businessToday();
    await invoiceReminders(today);
    await invoiceReminders(today);
    expect(await commsWith(`invoice-due:${invoiceId}:`)).toBe(1);
  });

  it("reminds on configured days before a tracked document expires, once per threshold", async () => {
    const today = await businessToday();
    const docId = await commitTx((tx) => insertDocument(tx, w.A.carrierId, "certificate_of_insurance", { status: "accepted", expiresOn: addDays(today, 7) }));
    await documentExpirationReminders(today);
    await documentExpirationReminders(today);
    expect(await commsWith(`doc-expiry:${docId}:7:`)).toBe(1);
  });

  it("marks accepted documents expired once past their date and opens a task", async () => {
    const today = await businessToday();
    const docId = await commitTx((tx) => insertDocument(tx, w.A.carrierId, "truck_registration", { status: "accepted", expiresOn: addDays(today, -1) }));
    await documentExpirationReminders(today);
    const { rows } = await getPool().query(`select status::text from public.documents where id = $1`, [docId]);
    expect(rows[0].status).toBe("expired");
    const tasks = await getPool().query(`select 1 from public.tasks where dedupe_key = $1`, [`doc-expired:${docId}`]);
    expect(tasks.rowCount).toBe(1);
  });
});

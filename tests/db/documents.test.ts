/**
 * Private document access: document rows and storage objects are visible only
 * to the owning carrier (carrier-visible documents), assigned staff and admins.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM, closePool, rollbackTx } from "./support/harness";
import { type World, createWorld, insertDocument } from "./support/world";

let w: World;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

describe("storage object access", () => {
  it("carrier users can read only their own document objects", async () => {
    await rollbackTx(async (tx) => {
      const own = await tx.one<{ n: number }>(
        w.A.owner,
        `select count(*)::int as n from storage.objects where bucket_id = 'carrier-documents' and name like 'carriers/' || $1 || '/%'`,
        [w.A.carrierId],
      );
      expect(own.n).toBeGreaterThan(0);
      const other = await tx.one<{ n: number }>(
        w.A.owner,
        `select count(*)::int as n from storage.objects where bucket_id = 'carrier-documents' and name like 'carriers/' || $1 || '/%'`,
        [w.B.carrierId],
      );
      expect(other.n).toBe(0);
      const dispatcher = await tx.one<{ n: number }>(
        w.dispatcherA,
        `select count(*)::int as n from storage.objects where name like 'carriers/' || $1 || '/%'`,
        [w.B.carrierId],
      );
      expect(dispatcher.n).toBe(0);
    });
  });

  it("clients cannot write storage objects directly", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(
        w.A.owner,
        `insert into storage.objects (bucket_id, name) values ('carrier-documents', 'carriers/' || $1 || '/x/evil.pdf')`,
        [w.A.carrierId],
        /row-level security/,
      );
      expect(await tx.count(w.A.owner, `delete from storage.objects where name like 'carriers/' || $1 || '/%'`, [w.A.carrierId])).toBe(0);
    });
  });

  it("the document bucket is private", async () => {
    await rollbackTx(async (tx) => {
      const { public: isPublic } = await tx.one<{ public: boolean }>(SYSTEM, `select public from storage.buckets where id = 'carrier-documents'`);
      expect(isPublic).toBe(false);
    });
  });
});

describe("document rows", () => {
  it("internal documents are hidden from carriers, including their storage objects", async () => {
    await rollbackTx(async (tx) => {
      const id = await insertDocument(tx, w.A.carrierId, "other", { visibility: "internal" });
      expect(await tx.count(w.A.owner, `select 1 from public.documents where id = $1`, [id])).toBe(0);
      expect(
        await tx.count(w.A.owner, `select 1 from storage.objects o join (select 'carriers/' || $2 || '/' || $1 || '/other.pdf' as p) x on x.p = o.name`, [id, w.A.carrierId]),
      ).toBe(0);
      expect(await tx.count(w.dispatcherA, `select 1 from public.documents where id = $1`, [id])).toBe(1);
    });
  });

  it("carrier uploads start as 'uploading' and can only be finalized to pending review", async () => {
    await rollbackTx(async (tx) => {
      const id = randomUUID();
      const path = `carriers/${w.A.carrierId}/${id}/coi.pdf`;
      await tx.query(
        w.A.member,
        `insert into public.documents (id, carrier_id, doc_type, status, storage_path, original_filename, mime_type, size_bytes, visibility, uploaded_by)
         values ($1, $2, 'certificate_of_insurance', 'accepted', $3, 'coi.pdf', 'application/pdf', 1234, 'internal', $4)`,
        [id, w.A.carrierId, path, w.A.ownerId],
      );
      const row = await tx.one<{ status: string; visibility: string; uploaded_by: string }>(
        SYSTEM,
        `select status::text, visibility, uploaded_by from public.documents where id = $1`,
        [id],
      );
      expect(row).toEqual({ status: "uploading", visibility: "carrier", uploaded_by: w.A.memberId });
      expect(await tx.count(w.A.member, `update public.documents set status = 'pending_review' where id = $1`, [id])).toBe(1);
      await tx.rejects(w.A.member, `update public.documents set status = 'accepted' where id = $1`, [id], /invalid document status change/);
      await tx.rejects(w.A.member, `update public.documents set storage_path = 'carriers/x/y/z.pdf' where id = $1`, [id], /immutable/);
      // Another member of the same carrier cannot change someone else's upload.
      expect(await tx.count(w.A.owner, `update public.documents set status = 'pending_review' where id = $1`, [id])).toBe(0);
    });
  });

  it("document paths must stay inside the carrier's folder", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(
        w.A.owner,
        `insert into public.documents (carrier_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
         values ($1::uuid, 'w9', 'carriers/' || $2::text || '/x/w9.pdf', 'w9.pdf', 'application/pdf', 100)`,
        [w.A.carrierId, w.B.carrierId],
        /documents_path_scope/,
      );
      await tx.rejects(
        w.A.owner,
        `insert into public.documents (carrier_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
         values ($1::uuid, 'w9', 'carriers/' || $1::text || '/../x/w9.pdf', 'w9.pdf', 'application/pdf', 100)`,
        [w.A.carrierId],
        /documents_storage_path_check/,
      );
    });
  });

  it("rejects disallowed file types and oversized files", async () => {
    await rollbackTx(async (tx) => {
      const base = `insert into public.documents (carrier_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
                    values ($1::uuid, 'w9', 'carriers/' || $1::text || '/x/f', 'f', $2, $3)`;
      await tx.rejects(w.A.owner, base, [w.A.carrierId, "application/x-msdownload", 100], /documents_mime_type_check/);
      await tx.rejects(w.A.owner, base, [w.A.carrierId, "application/pdf", 10485761], /documents_size_bytes_check/);
    });
  });

  it("accepting a COI supersedes the previous one and updates the insurance date", async () => {
    await rollbackTx(async (tx) => {
      const id = await insertDocument(tx, w.A.carrierId, "certificate_of_insurance", { status: "pending_review", expiresOn: "2031-06-30" });
      await tx.query(w.dispatcherA, `update public.documents set status = 'accepted' where id = $1`, [id]);
      const carrier = await tx.one<{ d: string }>(SYSTEM, `select insurance_expiration_date::text as d from public.carriers where id = $1`, [w.A.carrierId]);
      expect(carrier.d).toBe("2031-06-30");
      const statuses = await tx.rows<{ status: string }>(
        SYSTEM,
        `select status::text from public.documents where carrier_id = $1 and doc_type = 'certificate_of_insurance' order by created_at`,
        [w.A.carrierId],
      );
      expect(statuses.map((s) => s.status)).toEqual(["superseded", "accepted"]);
      const reviewed = await tx.one<{ reviewed_by: string }>(SYSTEM, `select reviewed_by from public.documents where id = $1`, [id]);
      expect(reviewed.reviewed_by).toBe(w.dispatcherAId);
    });
  });

  it("accepted documents cannot be withdrawn by carriers and documents cannot move between carriers", async () => {
    await rollbackTx(async (tx) => {
      const { id } = await tx.one<{ id: string }>(SYSTEM, `select id from public.documents where carrier_id = $1 and doc_type = 'w9'`, [w.A.carrierId]);
      await tx.query(SYSTEM, `update public.documents set uploaded_by = $2 where id = $1`, [id, w.A.ownerId]);
      await tx.rejects(w.A.owner, `update public.documents set deleted_at = now() where id = $1`, [id], /accepted documents are retained/);
      await tx.rejects(w.admin, `update public.documents set carrier_id = $2 where id = $1`, [id, w.B.carrierId], /cannot be moved/);
    });
  });

  it("application-stage documents are visible to staff but not to other carriers", async () => {
    await rollbackTx(async (tx) => {
      const { id: appId } = await tx.one<{ id: string }>(SYSTEM, `insert into public.carrier_applications (email) values ('applicant@test.example') returning id`);
      const docId = randomUUID();
      await tx.query(
        SYSTEM,
        `insert into public.documents (id, application_id, doc_type, status, storage_path, original_filename, mime_type, size_bytes)
         values ($1::uuid, $2::uuid, 'w9', 'pending_review', 'applications/' || $2::text || '/' || $1::text || '/w9.pdf', 'w9.pdf', 'application/pdf', 100)`,
        [docId, appId],
      );
      expect(await tx.count(w.admin, `select 1 from public.documents where id = $1`, [docId])).toBe(1);
      expect(await tx.count(w.A.owner, `select 1 from public.documents where id = $1`, [docId])).toBe(0);
    });
  });
});

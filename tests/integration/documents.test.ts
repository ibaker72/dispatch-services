/**
 * Document uploads through the application service with real user tokens:
 * RLS decides which carrier a user can attach files to, and stored bytes are
 * verified before a document becomes reviewable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs } from "./support/clients";
import { closePool, getPool } from "../db/support/harness";
import { type World, createWorld } from "../db/support/world";
import { finalizeDocumentUpload, requestDocumentUpload } from "@/lib/documents/service";
import { localStorageDriver, storage, verifyLocalToken } from "@/lib/storage";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const request = (carrierId: string, extra: Partial<Parameters<typeof requestDocumentUpload>[2]> = {}) => ({
  carrierId,
  docType: "w9" as const,
  filename: "w9.pdf",
  mimeType: "application/pdf",
  size: PDF.byteLength,
  ...extra,
});

describe("carrier document uploads", () => {
  it("an owner uploads to their own carrier; verified bytes become pending review with a hash", async () => {
    const supabase = clientAs(w.A.ownerId);
    const { documentId, upload } = await requestDocumentUpload(supabase, w.A.ownerId, request(w.A.carrierId));
    expect(upload.method).toBe("PUT");
    const { rows } = await getPool().query(`select storage_path, status::text, uploaded_by from public.documents where id = $1`, [documentId]);
    expect(rows[0]).toMatchObject({ status: "uploading", uploaded_by: w.A.ownerId });
    await localStorageDriver()!.write(rows[0].storage_path, PDF);
    await finalizeDocumentUpload(supabase, w.A.ownerId, documentId);
    const after = await getPool().query(`select status::text, sha256 from public.documents where id = $1`, [documentId]);
    expect(after.rows[0].status).toBe("pending_review");
    expect(after.rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cannot attach documents to another carrier", async () => {
    await expect(requestDocumentUpload(clientAs(w.A.ownerId), w.A.ownerId, request(w.B.carrierId))).rejects.toThrow(/cannot upload/i);
    await expect(requestDocumentUpload(clientAs(w.dispatcherAId), w.dispatcherAId, request(w.B.carrierId))).rejects.toThrow(/cannot upload/i);
  });

  it("rejects files whose content does not match the declared type and withdraws the row", async () => {
    const supabase = clientAs(w.A.memberId);
    const { documentId } = await requestDocumentUpload(supabase, w.A.memberId, request(w.A.carrierId, { docType: "other", filename: "note.pdf" }));
    const { rows } = await getPool().query(`select storage_path from public.documents where id = $1`, [documentId]);
    await localStorageDriver()!.write(rows[0].storage_path, new TextEncoder().encode("<script>alert(1)</script>"));
    await expect(finalizeDocumentUpload(supabase, w.A.memberId, documentId)).rejects.toThrow();
    const after = await getPool().query(`select deleted_at from public.documents where id = $1`, [documentId]);
    expect(after.rows[0].deleted_at).not.toBeNull();
  });

  it("refuses disallowed types and sizes before anything is stored", async () => {
    const supabase = clientAs(w.A.ownerId);
    await expect(requestDocumentUpload(supabase, w.A.ownerId, request(w.A.carrierId, { filename: "x.exe", mimeType: "application/x-msdownload" }))).rejects.toThrow();
    await expect(requestDocumentUpload(supabase, w.A.ownerId, request(w.A.carrierId, { size: 50 * 1024 * 1024 }))).rejects.toThrow();
  });

  it("download links are short-lived and bound to one object", async () => {
    const url = new URL(await storage().createSignedDownload(`carriers/${w.A.carrierId}/00000000-0000-0000-0000-000000000000/w9.pdf`, "w9.pdf"));
    const secret = process.env.LOCAL_STORAGE_SIGNING_SECRET!;
    const p = url.searchParams;
    expect(verifyLocalToken(secret, "download", p.get("path")!, Number(p.get("exp")), p.get("sig")!, p.get("name") ?? "")).toBe(true);
    expect(verifyLocalToken(secret, "download", `carriers/${w.B.carrierId}/x/w9.pdf`, Number(p.get("exp")), p.get("sig")!, p.get("name") ?? "")).toBe(false);
    expect(Number(p.get("exp")) - Date.now() / 1000).toBeLessThanOrEqual(61);
  });
});

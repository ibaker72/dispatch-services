import "server-only";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ConfigurationError, serverEnv } from "@/lib/env";
import { constantTimeEqual } from "@/lib/security/tokens";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Private document storage adapter.
 *
 *  - `supabase` (default): private Supabase Storage bucket. Uploads use
 *    short-lived signed upload URLs; downloads use signed URLs that expire in
 *    60 seconds.
 *  - `local`: development/test driver writing to LOCAL_STORAGE_DIR with
 *    HMAC-signed, expiring URLs served by /api/storage/local. Refused in
 *    production by the environment validator.
 *
 * Authorization happens before any call here: callers first read the
 * `documents` row with the user's RLS-scoped client.
 */
export const DOCUMENT_BUCKET = "carrier-documents";
export const SIGNED_DOWNLOAD_TTL_SECONDS = 60;
export const SIGNED_UPLOAD_TTL_SECONDS = 600;

export interface SignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface StorageDriver {
  createSignedUpload(objectPath: string, contentType: string): Promise<SignedUpload>;
  createSignedDownload(objectPath: string, downloadName: string): Promise<string>;
  download(objectPath: string): Promise<Uint8Array | null>;
  remove(objectPath: string): Promise<void>;
}

function assertSafePath(objectPath: string): void {
  if (!/^(carriers|applications)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/.test(objectPath)) {
    throw new Error("unsafe storage path");
  }
}

class SupabaseStorageDriver implements StorageDriver {
  private bucket() {
    return createSupabaseAdminClient().storage.from(DOCUMENT_BUCKET);
  }

  async createSignedUpload(objectPath: string, contentType: string): Promise<SignedUpload> {
    assertSafePath(objectPath);
    const { data, error } = await this.bucket().createSignedUploadUrl(objectPath);
    if (error || !data) throw new Error(`could not create upload URL: ${error?.message}`);
    return {
      url: data.signedUrl,
      method: "PUT",
      headers: {
        "content-type": contentType,
        "x-upsert": "false",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      },
    };
  }

  async createSignedDownload(objectPath: string, downloadName: string): Promise<string> {
    assertSafePath(objectPath);
    const { data, error } = await this.bucket().createSignedUrl(objectPath, SIGNED_DOWNLOAD_TTL_SECONDS, { download: downloadName });
    if (error || !data) throw new Error(`could not sign download: ${error?.message}`);
    return data.signedUrl;
  }

  async download(objectPath: string): Promise<Uint8Array | null> {
    assertSafePath(objectPath);
    const { data, error } = await this.bucket().download(objectPath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async remove(objectPath: string): Promise<void> {
    assertSafePath(objectPath);
    await this.bucket().remove([objectPath]);
  }
}

export type LocalOperation = "upload" | "download";

export function signLocalToken(secret: string, op: LocalOperation, objectPath: string, expires: number, name = ""): string {
  return createHmac("sha256", secret).update(`${op}\n${objectPath}\n${expires}\n${name}`).digest("base64url");
}

export function verifyLocalToken(
  secret: string,
  op: LocalOperation,
  objectPath: string,
  expires: number,
  signature: string,
  name = "",
  now = Date.now(),
): boolean {
  if (!Number.isFinite(expires) || expires * 1000 < now) return false;
  return constantTimeEqual(signLocalToken(secret, op, objectPath, expires, name), signature);
}

export class LocalStorageDriver implements StorageDriver {
  constructor(
    private readonly root: string,
    private readonly secret: string,
  ) {}

  private file(objectPath: string) {
    assertSafePath(objectPath);
    return path.join(this.root, DOCUMENT_BUCKET, objectPath);
  }

  private signedUrl(op: LocalOperation, objectPath: string, ttl: number, name = "") {
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const sig = signLocalToken(this.secret, op, objectPath, expires, name);
    const params = new URLSearchParams({ op, path: objectPath, exp: String(expires), sig });
    if (name) params.set("name", name);
    return `${siteUrl()}/api/storage/local?${params.toString()}`;
  }

  async createSignedUpload(objectPath: string, contentType: string): Promise<SignedUpload> {
    return { url: this.signedUrl("upload", objectPath, SIGNED_UPLOAD_TTL_SECONDS), method: "PUT", headers: { "content-type": contentType } };
  }

  async createSignedDownload(objectPath: string, downloadName: string): Promise<string> {
    return this.signedUrl("download", objectPath, SIGNED_DOWNLOAD_TTL_SECONDS, downloadName);
  }

  async download(objectPath: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.file(objectPath)));
    } catch {
      return null;
    }
  }

  async write(objectPath: string, bytes: Uint8Array): Promise<void> {
    const target = this.file(objectPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: "wx" });
  }

  async remove(objectPath: string): Promise<void> {
    await fs.rm(this.file(objectPath), { force: true });
  }
}

let driver: StorageDriver | undefined;

export function storage(): StorageDriver {
  if (driver) return driver;
  const env = serverEnv();
  if (env.STORAGE_DRIVER === "local") {
    if (!env.LOCAL_STORAGE_DIR || !env.LOCAL_STORAGE_SIGNING_SECRET) {
      throw new ConfigurationError("LOCAL_STORAGE_DIR and LOCAL_STORAGE_SIGNING_SECRET are required for STORAGE_DRIVER=local");
    }
    driver = new LocalStorageDriver(env.LOCAL_STORAGE_DIR, env.LOCAL_STORAGE_SIGNING_SECRET);
  } else {
    driver = new SupabaseStorageDriver();
  }
  return driver;
}

export function localStorageDriver(): LocalStorageDriver | null {
  const d = storage();
  return d instanceof LocalStorageDriver ? d : null;
}

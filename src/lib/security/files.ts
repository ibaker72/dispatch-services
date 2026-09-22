/**
 * Upload validation. Declared metadata is checked before a signed upload URL
 * is issued, and the stored bytes are sniffed (magic numbers) and hashed when
 * the upload is finalized. Anything that does not match is deleted.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_UPLOAD_TYPES;

export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
  return Object.hasOwn(ALLOWED_UPLOAD_TYPES, mime);
}

/** Identifies the real file type from its first bytes. */
export function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  return null;
}

export function sanitizeFilename(name: string, mime: AllowedMimeType): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const withoutExt = base.replace(/\.[^.]*$/, "");
  const cleaned = withoutExt
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${cleaned || "document"}.${ALLOWED_UPLOAD_TYPES[mime][0]}`;
}

export interface UploadMetadata {
  filename: string;
  mimeType: string;
  size: number;
}

export type UploadCheck = { ok: true; mimeType: AllowedMimeType; safeName: string } | { ok: false; error: string };

export function validateUploadMetadata(meta: UploadMetadata): UploadCheck {
  if (!isAllowedMimeType(meta.mimeType)) {
    return { ok: false, error: "Upload a PDF, PNG, JPEG or WebP file." };
  }
  if (!Number.isInteger(meta.size) || meta.size <= 0) return { ok: false, error: "The file is empty." };
  if (meta.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Files must be 10 MB or smaller." };
  const ext = meta.filename.toLowerCase().split(".").pop() ?? "";
  if (!(ALLOWED_UPLOAD_TYPES[meta.mimeType] as readonly string[]).includes(ext)) {
    return { ok: false, error: "The file extension does not match its type." };
  }
  return { ok: true, mimeType: meta.mimeType, safeName: sanitizeFilename(meta.filename, meta.mimeType) };
}

/** Final check against the stored bytes. */
export function verifyStoredFile(bytes: Uint8Array, declared: AllowedMimeType): { ok: true } | { ok: false; error: string } {
  if (bytes.byteLength === 0) return { ok: false, error: "The uploaded file is empty." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "Files must be 10 MB or smaller." };
  const actual = sniffMimeType(bytes);
  if (actual !== declared) return { ok: false, error: "The file contents do not match its type." };
  return { ok: true };
}

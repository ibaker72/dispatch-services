/**
 * Validates post-login / post-confirmation redirect targets. Only same-site
 * relative paths are allowed; absolute URLs are accepted only when they point
 * at the site's own origin (e.g. Supabase email templates pass RedirectTo as
 * an absolute URL) and are reduced to a path.
 */
const CONTROL = /[\u0000-\u001f\u007f]/;

export function safeRedirectPath(input: string | null | undefined, fallback = "/", siteOrigin?: string): string {
  if (!input || typeof input !== "string") return fallback;
  let value = input.trim();
  if (value.length === 0 || value.length > 2048) return fallback;

  // Decode once so encoded tricks like %2F%2Fevil.com are evaluated as the browser would.
  try {
    const decoded = decodeURIComponent(value);
    if (CONTROL.test(decoded) || decoded.includes("\\")) return fallback;
    if (decoded.startsWith("//")) return fallback;
  } catch {
    return fallback;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    if (!siteOrigin) return fallback;
    try {
      const url = new URL(value);
      const origin = new URL(siteOrigin);
      if (url.origin !== origin.origin) return fallback;
      value = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return fallback;
    }
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (CONTROL.test(value) || value.includes("\\")) return fallback;
  // Never bounce back into auth endpoints (avoids loops and token re-use).
  if (/^\/(auth\/(confirm|callback)|api\/)/.test(value)) return fallback;
  return value;
}

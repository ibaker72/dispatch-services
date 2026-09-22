/**
 * Lightweight bot protection for public forms: a honeypot field that real
 * users never see, plus a minimum time between render and submit. Requests
 * that trip either check receive a normal-looking success response and are
 * silently discarded, so bots learn nothing. Optional Cloudflare Turnstile
 * verification is enabled when TURNSTILE_SECRET_KEY is set.
 */
export const MIN_FILL_MS = 2500;

export function looksLikeBot(input: { company_website?: string | null; started_at?: number | null }, now = Date.now()): boolean {
  if (input.company_website && input.company_website.trim() !== "") return true;
  if (typeof input.started_at === "number" && input.started_at > 0 && now - input.started_at < MIN_FILL_MS) return true;
  return false;
}

export async function verifyTurnstile(token: string | null | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

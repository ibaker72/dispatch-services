import "server-only";
import { PostHog } from "posthog-node";
import { type AnalyticsEvent, type AnalyticsProps, sanitizeEventProperties } from "./events";
import { sha256Hex } from "@/lib/security/tokens";

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  client = key
    ? new PostHog(key, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com", flushAt: 1, flushInterval: 0 })
    : null;
  return client;
}

/**
 * Server-side event capture. The distinct id is a salted hash of an internal
 * UUID (never an email or name), so analytics cannot be joined to a person
 * without database access.
 */
export async function trackServer<E extends AnalyticsEvent>(event: E, subjectId: string, props?: AnalyticsProps<E>): Promise<void> {
  const ph = getClient();
  if (!ph) return;
  try {
    const distinctId = sha256Hex(`${process.env.RATE_LIMIT_SALT ?? "analytics"}:${subjectId}`).slice(0, 32);
    ph.capture({
      distinctId,
      event,
      properties: { ...sanitizeEventProperties(event, props as Record<string, unknown>), $process_person_profile: false },
    });
    await ph.flush();
  } catch (error) {
    console.error("[analytics] capture failed", error instanceof Error ? error.message : error);
  }
}

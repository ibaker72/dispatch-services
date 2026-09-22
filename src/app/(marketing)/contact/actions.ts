"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { type ActionResult, runAction } from "@/lib/actions";
import { trackServer } from "@/lib/analytics/server";
import { isPlaceholder } from "@/config/business";
import { sendEmailSafely } from "@/lib/email/send";
import { adminNotificationEmails } from "@/lib/env";
import { looksLikeBot, verifyTurnstile } from "@/lib/security/bot";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { getBusinessProfile } from "@/lib/settings";
import { CONTACT_TOPICS, type ContactInput, contactSchema } from "@/lib/validation/public-forms";

export async function submitContact(input: ContactInput & { turnstile_token?: string }): Promise<ActionResult<null>> {
  return runAction(contactSchema, input, async (data) => {
    const h = await headers();
    const ip = clientIp(h);
    await enforceRateLimit("contact", ip);
    if (looksLikeBot(data) || !(await verifyTurnstile(input.turnstile_token, ip))) return null;

    const profile = await getBusinessProfile();
    const recipients = adminNotificationEmails();
    if (recipients.length === 0 && !isPlaceholder(profile.email)) recipients.push(profile.email);
    const topic = CONTACT_TOPICS.find((t) => t.value === data.topic)?.label ?? data.topic;
    for (const to of recipients) {
      await sendEmailSafely({
        to,
        template: "contact_message",
        data: { topic, name: data.name, email: data.email, phone: data.phone || "—", message: data.message },
        replyTo: data.email,
      });
    }
    await trackServer("contact_submitted", randomUUID(), { topic: data.topic });
    return null;
  });
}

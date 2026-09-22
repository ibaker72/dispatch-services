"use client";

import posthog from "posthog-js";
import { type AnalyticsEvent, type AnalyticsProps, sanitizeEventProperties, sanitizeUrl } from "./events";

let initialized = false;

/**
 * Privacy-conscious PostHog setup: no autocapture, no session recording,
 * profiles only for identified users (we never identify with PII), Do Not
 * Track respected, and URLs stripped of query strings and record IDs.
 */
export function initAnalytics(): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (initialized || !key || typeof window === "undefined") return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    person_profiles: "identified_only",
    respect_dnt: true,
    persistence: "localStorage",
    ip: false,
    sanitize_properties: (properties) => {
      const clean = { ...properties };
      for (const key of ["$current_url", "$referrer", "$initial_referrer", "$pathname"]) {
        if (typeof clean[key] === "string") clean[key] = sanitizeUrl(clean[key] as string) ?? null;
      }
      delete clean.$ip;
      return clean;
    },
  });
  initialized = true;
}

export function trackPageview(): void {
  if (!initialized) return;
  posthog.capture("$pageview", { $current_url: sanitizeUrl(window.location.href) });
}

export function track<E extends AnalyticsEvent>(event: E, props?: AnalyticsProps<E>): void {
  if (!initialized) return;
  posthog.capture(event, sanitizeEventProperties(event, props as Record<string, unknown>));
}

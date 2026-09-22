"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { initAnalytics, trackPageview } from "@/lib/analytics/client";

/** Initializes privacy-conscious analytics (no-op without NEXT_PUBLIC_POSTHOG_KEY). */
export function AnalyticsProvider() {
  const pathname = usePathname();
  useEffect(() => {
    initAnalytics();
  }, []);
  useEffect(() => {
    trackPageview();
  }, [pathname]);
  return null;
}

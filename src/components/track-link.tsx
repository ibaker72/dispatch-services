"use client";

import Link from "next/link";
import type * as React from "react";
import { track } from "@/lib/analytics/client";

/** Link that records a CTA click (event name and location only). */
export function TrackLink({ cta, location, ...props }: React.ComponentProps<typeof Link> & { cta: string; location: string }) {
  return <Link {...props} onClick={(e) => { track("cta_clicked", { cta, location }); props.onClick?.(e); }} />;
}

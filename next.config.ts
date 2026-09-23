import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security/csp";

const extraActionOrigins = (process.env.SERVER_ACTION_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev-server logging of Server Function arguments would print passwords,
  // tokens and personal data to the terminal.
  logging: { serverFunctions: false },
  experimental: {
    serverActions: {
      // Uploads go directly to storage through signed URLs, so actions stay small.
      bodySizeLimit: "1mb",
      allowedOrigins: extraActionOrigins,
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: STATIC_SECURITY_HEADERS },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      {
        source: "/(dashboard|portal|login|mfa|apply|invite|reset-password|verify-email)(.*)",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Route browser error reports through this app so CSP stays 'self' and ad blockers do not drop them.
  tunnelRoute: "/monitoring",
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});

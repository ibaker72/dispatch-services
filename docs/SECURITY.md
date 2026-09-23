# Security model

## Authorization lives in the database

Every table in `public` has Row Level Security enabled and explicit policies
(`pnpm check:rls` fails the build otherwise). Server code uses the signed-in
user's Supabase client for reads and writes, so a bug in a page or action
cannot widen access. The service-role key is used only on the server for:
anonymous application drafts (scoped to the SHA-256 of an httpOnly draft
token), agreement-acceptance evidence, verified payment webhooks, scheduled
jobs, email delivery records, auth admin (invitations) and storage signing.

| Role | Can see and do |
| --- | --- |
| `super_admin` | Everything, including security-sensitive settings (MFA policy, sensitive feature flags, company authority, attorney approval, admin role grants). Sensitive actions also require a two-step-verified (`aal2`) session. |
| `admin` | All carriers and operations; billing; settings except sensitive ones; can grant the dispatcher role only. |
| `dispatcher` | Only carriers assigned to them (or all, if an admin grants `grants_all_carriers`); operational carrier fields, fleet, loads, documents, tasks. Cannot change carrier identity, status, verification, fee terms, billing or settings. |
| `carrier_owner` | Own organization only: approve/reject proposed loads, accept agreements, fleet, preferences, documents, team, pay invoices, cancellation. Never sees dispatcher opportunities, drafts, internal notes or internal documents. |
| `carrier_member` | Own organization, read loads, upload paperwork, post availability, support. Cannot approve loads, accept agreements, pay or manage the team. |

Staff and carrier memberships are mutually exclusive. When **Settings →
Security** requires admin MFA, admin database permissions require an `aal2`
JWT (enforced in `app.admin_mfa_satisfied()`), not only a UI redirect.

Tests: `tests/db/tenant-isolation.test.ts`, `tests/db/roles.test.ts` and the
other DB suites run every statement as the real Postgres roles with JWT
claims; `tests/integration/rls-write-paths.test.ts` repeats key write paths
through PostgREST; `e2e/authorization.spec.ts` checks the app end to end.

## Invariants the database refuses to break

Load reassignment, booking without carrier approval, completion without
paperwork, edits to closed loads, edits to fee snapshots, statements, invoices,
payments, agreement text or acceptances, audit log mutation, lease-on
enablement without the checklist. See COMPLIANCE_INVARIANTS.md.

## Web security

- **Headers**: nonce-based Content-Security-Policy (no `unsafe-inline` scripts
  in production), `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
  `Permissions-Policy`; `Cache-Control: no-store` for API and private pages;
  `noindex` for dashboard, portal and auth pages.
- **CSRF**: Server Actions are POST-only with Next's origin check plus our
  explicit same-origin assertion (`assertSameOrigin`). Route handlers that
  change state are webhooks (signature-verified) or cron (bearer secret).
- **Validation**: every action validates input with Zod on the server;
  database constraints and triggers validate again.
- **Redirects**: `safeRedirectPath` accepts only same-site relative paths.
- **Rate limiting**: Postgres-backed fixed windows (`rate_limit_hit`) for
  sign-in (per IP and per email), magic links, password resets, applications,
  uploads, downloads, invitations, checkout, MFA and exports.
- **Bots**: honeypot field and minimum fill time on public forms; optional
  Cloudflare Turnstile.
- **Files**: 10 MB limit, PDF/PNG/JPEG/WebP only, magic-byte sniffing after
  upload, SHA-256 recorded, sanitized names, private bucket, uploads via
  short-lived signed URLs, downloads via 60-second signed URLs issued only
  after an RLS-checked read (`/api/documents/:id/download`).
- **Secrets**: only `NEXT_PUBLIC_*` values reach the browser; `server-only`
  guards server modules; production refuses development adapters.
- **CSV exports**: RLS-scoped, formula-injection neutralized (`toCsv`).
- **Sensitive data**: no SSNs or bank credentials are collected; full EINs and
  SSN-like numbers are rejected in the application; only EIN last four stored.

## Monitoring and privacy

- **Audit log**: append-only `audit_events` written by triggers for carriers,
  applications, loads, documents, agreements, billing, roles, settings and
  security events (sign-in, MFA, password changes). Sensitive columns are
  redacted. Admins can filter and export it.
- **Sentry**: request bodies, cookies, auth headers and query strings are
  stripped; values that look like emails, phone numbers, tokens or long digit
  strings are redacted (`src/lib/observability/scrub.ts`). No session replay.
- **PostHog**: no autocapture, no session recording, no identify calls with
  PII; only catalogued events with enum-like properties; values that look like
  emails, phone/MC/DOT numbers, VINs, file names or money are dropped
  (`src/lib/analytics/events.ts`). Server events use salted hashed ids.
- **Development logging**: Server Function argument logging is disabled so
  passwords and tokens never reach the terminal.

## Reporting

Report vulnerabilities to the security contact in **Settings → Business
profile** (email). Do not include carrier data in reports.

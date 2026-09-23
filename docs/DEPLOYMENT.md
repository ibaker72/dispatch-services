# Deployment: Vercel + Supabase

## 1. Supabase project

1. Create a Supabase project (US region). Note the project URL, the
   publishable/anon key and the secret/service-role key.
2. Apply the migrations in order: `supabase link --project-ref <ref>` then
   `supabase db push` (or run each file in `supabase/migrations` in order in the
   SQL editor). Then run `pnpm check:rls` with `DATABASE_URL` pointing at the
   project (direct connection string) — it must pass.
3. **Auth settings**
   - Site URL: `https://<your-domain>`; redirect URLs: `https://<your-domain>/auth/confirm`, `https://<your-domain>/auth/callback`.
   - Disable public sign-ups (carriers join through application approval/invitation).
   - Minimum password length 12; enable TOTP MFA.
   - Email templates: paste the files from `supabase/templates/` (they link to
     `/auth/confirm?token_hash=…`, which works across browsers and devices).
   - Custom SMTP: use Resend SMTP (`smtp.resend.com`, port 465, user `resend`,
     password = Resend API key) so auth emails come from your domain.
4. **Storage**: the migrations create the private bucket `carrier-documents`
   (10 MB, PDF/PNG/JPEG/WebP). Do not make it public. Downloads use 60-second
   signed URLs issued only after an RLS-checked read.
5. **First administrator**: sign up is disabled, so create the first user in
   *Authentication → Users → Invite*, then in the SQL editor:
   `insert into public.user_roles (user_id, role) values ('<user id>', 'super_admin');`
   Sign in, enroll MFA (**Settings → Security**), then invite other staff from
   **Settings → Security & staff**.
6. Update business details in **Settings → Business profile** and publish
   attorney-reviewed agreement versions in **Settings → Agreements**.

## 2. Vercel project

1. Import the repository. Framework preset: Next.js. Install command
   `pnpm install --frozen-lockfile`, build command `pnpm build`.
2. Environment variables (Production and Preview): see `.env.example`. Required
   in production:

   | Variable | Value |
   | --- | --- |
   | `APP_ENV` | `production` (use `staging` for previews) |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase (server only) |
   | `STORAGE_DRIVER` | `supabase` |
   | `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFICATION_EMAILS` | Resend |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe (or `PAYMENTS_DRIVER=manual`) |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `RATE_LIMIT_SALT` | `openssl rand -hex 32` |
   | `LEASE_ON_OPERATIONS_ENABLED` | `false` |

   Optional: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`
   (source maps), `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`.
   The app refuses to start with development adapters in production.
3. Add your domain and enforce HTTPS. Security headers and the nonce-based CSP
   are applied by the app (`src/proxy.ts`, `next.config.ts`).

## 3. Stripe (dispatch invoices only)

Stripe collects only the dispatch company's own service invoice from the
carrier. Never use it for broker or shipper freight payments.

1. Create a restricted or standard secret key → `STRIPE_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint**: `https://<your-domain>/api/stripe/webhook`
   with events `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`. Copy the signing secret →
   `STRIPE_WEBHOOK_SECRET`.
3. Payments are recorded idempotently (event, session and payment-intent ids
   are unique). Test with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
4. Turn online payments off with the `online_invoice_payments` feature flag or
   `PAYMENTS_DRIVER=manual`; invoices then show manual instructions (configure
   `manualPayment` in `src/config/business.ts`).

## 4. Resend DNS

1. Add your sending domain in Resend (a subdomain such as `mail.<domain>` is
   recommended).
2. Create the DNS records Resend shows: the SPF `TXT` (and `MX` for the bounce
   subdomain) and the DKIM `TXT` records; wait for verification.
3. Add DMARC: `_dmarc.<domain>  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>"`
   (start with `p=none` while monitoring if you prefer).
4. Set `EMAIL_FROM` to an address on the verified domain.

## 5. Scheduled jobs

`vercel.json` schedules each job (UTC). Vercel Cron calls
`GET /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET`.

| Job | Schedule (UTC) | Purpose |
| --- | --- | --- |
| `daily-operations-summary` | `0 11 * * *` | Morning summary to `ADMIN_NOTIFICATION_EMAILS` |
| `weekly-statements` | `0 12 * * 1` | Previous week's statements (drafts, or issued if auto-issue is on) |
| `document-expiration-reminders` | `0 13 * * *` | Reminders at configured days; marks expired documents |
| `invoice-reminders` | `0 14 * * *` | Due-soon and overdue reminders |
| `onboarding-reminders` | `30 14 * * *` | Missing-document reminders during onboarding |
| `stale-application-follow-up` | `0 15 * * *` | Tasks for unreviewed applications; applicant reminders |
| `retry-failed-notifications` | `0 * * * *` | Retries failed emails with backoff |

Vercel Hobby allows only daily cron jobs; on Hobby remove the hourly entry and
call `/api/cron/retry-failed-notifications` from another scheduler (GitHub
Actions, cron-job.org, Supabase `pg_cron` + `pg_net`) with the bearer secret.
Each run is recorded in `job_runs` and visible in **Settings → Scheduled jobs**;
runs are idempotent per run key, so retries are safe.

## 6. Backups and recovery

- **Database**: enable Supabase daily backups; on Pro enable Point-in-Time
  Recovery. Before each migration, take a manual backup
  (`pg_dump --format=custom --no-owner "$DATABASE_URL" > backup.dump`).
- **Storage**: documents live in the `carrier-documents` bucket. Schedule an
  off-site copy (e.g. a nightly job using the service key to sync to an S3
  bucket with versioning and object lock). Database rows keep SHA-256 hashes,
  so restored files can be verified.
- **Restore drill** (quarterly): restore the latest backup into a new Supabase
  project, run `pnpm check:rls` and `pnpm test:db` against it with
  `DATABASE_URL`, point a preview deployment at it and sign in as an admin.
- Audit events, agreement acceptances, fee snapshots, statements, invoices and
  payments are append-only or immutable by design; never "fix" them by editing
  rows — use the correction workflows (void and regenerate, credits, refunds).

## 7. Release checklist

- `pnpm verify` and `pnpm test:e2e` green; `pnpm audit:deps` clean.
- Migrations applied to staging first; `pnpm check:rls` against staging.
- Business profile has no placeholders (the dashboard shows a banner until it is complete).
- Agreement versions reviewed and published; legal pages reviewed (docs/LEGAL_REVIEW.md).
- MFA required for admins (**Settings → Security**).
- `LEASE_ON_OPERATIONS_ENABLED=false`.

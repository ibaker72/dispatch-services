# Local development

## Option A — Docker-free local stack (used by the test suite)

`scripts/local-stack/stack.mjs` assembles the Supabase pieces the app uses
without Docker:

| Service | Port | Notes |
| --- | --- | --- |
| Gateway (`/auth/v1`, `/rest/v1`, email templates) | 54321 | `NEXT_PUBLIC_SUPABASE_URL` |
| Postgres 16 | 54322 | local binaries (`initdb`, `pg_ctl`) must be installed |
| PostgREST 12 | 54323 | downloaded on first start |
| Supabase Auth (GoTrue) | 54324 | downloaded on first start |
| SMTP sink | 54325 | auth emails are written to `.local-stack/mail` |

```bash
pnpm stack:start     # starts everything, applies supabase/migrations, writes .local-stack/env
pnpm stack:status
pnpm stack:stop
pnpm stack:reset     # wipes local data and re-applies migrations
```

`.local-stack/env` contains throwaway local keys (anon, service role, database
URL, JWT secret). Copy the Supabase values into `.env.local` and add the
development adapters:

```dotenv
APP_ENV=development
NEXT_PUBLIC_SITE_URL=http://localhost:3000
STORAGE_DRIVER=local                      # files in .local-stack/storage via signed URLs
LOCAL_STORAGE_SIGNING_SECRET=any-local-secret
EMAIL_DRIVER=outbox                       # emails written as JSON to .local-stack/outbox
PAYMENTS_DRIVER=mock                      # /dev/mock-checkout instead of Stripe
RATE_LIMIT_SALT=any-local-salt
CRON_SECRET=local-dev-cron-secret
ADMIN_NOTIFICATION_EMAILS=admin@demo.example
LEASE_ON_OPERATIONS_ENABLED=false
```

The production environment validator refuses `STORAGE_DRIVER=local`,
`EMAIL_DRIVER=outbox` and `PAYMENTS_DRIVER=mock`.

## Option B — Supabase CLI (Docker)

`supabase/config.toml` configures the CLI stack (email templates, redirect
URLs, private storage bucket). Run `supabase start`, copy the printed API URL,
anon key and service role key into `.env.local`, then `supabase db reset` to
apply `supabase/migrations`. Everything else is identical.

## Seed data

```bash
pnpm seed
```

Creates fictional data only: a super admin, a dispatcher, two isolated carriers
(one percentage plan, one flat weekly plan) with trucks, drivers, loads in
several states, documents, published **draft** agreements (for demo use only),
a weekly statement, an invoice and a payment. The seed refuses
`APP_ENV=production` and non-local database URLs unless `--allow-remote` is
passed. It is idempotent.

## Working with emails, payments and jobs locally

- **Emails**: open the newest JSON file in `.local-stack/outbox`. Supabase Auth
  emails (invite, magic link, recovery) are in `.local-stack/mail`.
- **Payments**: "Pay online" opens `/dev/mock-checkout`; "Pay (test)" sends a
  signed event to `/api/payments/webhook`, which records the payment through
  the same code path as Stripe.
- **Jobs**: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/<job>`
  or use **Dashboard → Settings → Scheduled jobs → Run now**.

## Tests

```bash
pnpm test               # unit
pnpm test:db            # Postgres RLS/workflow tests (needs the stack)
pnpm test:integration   # server modules against the stack with real user JWTs
pnpm build && pnpm test:e2e   # Playwright (starts `pnpm start`; seeds first)
E2E_BASE_URL=http://localhost:3000 pnpm test:e2e   # reuse a running server
pnpm verify             # typecheck, lint, hint check, unit, RLS gate, db, integration, build
```

Database types are generated from the live schema: `pnpm db:types` after
changing migrations.

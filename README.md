# Dispatch services platform

Public website, carrier application, internal dispatch dashboard and carrier
portal for a truck dispatch service that works **for carriers under their own
operating authority**. The service is paid only by carriers, never acts as a
broker, never collects freight payments and never moves a load between
carriers.

> Business details are placeholders (`[BUSINESS NAME]`, `[LEGAL ENTITY]`,
> `[EMAIL]`, `[PHONE]`, `[ADDRESS]`, `[DOMAIN]`). Set them in
> `src/config/business.ts` or in **Dashboard → Settings → Business profile**.
> Agreement templates and legal pages require attorney review before use —
> see [docs/LEGAL_REVIEW.md](docs/LEGAL_REVIEW.md).

## What is included

| Area | Highlights |
| --- | --- |
| Public site | Home, services, car hauler / hotshot / box truck / dry van pages, pricing (7% or $300/truck/week), how it works, about, contact, privacy, terms, dispatch relationship disclosure, lease-on waitlist. SEO metadata, structured data, sitemap, robots. |
| Carrier application | 9 steps, autosave and resume links, private document uploads, EIN last four only (full SSNs/EINs rejected), consent evidence. |
| Dispatch dashboard | Operations overview (carrier revenue shown separately from dispatch fees), application review and approval, carrier workspace (onboarding checklist, fee term versions, authority verification, fleet, documents, portal users, activity), load board and workflow, documents and expirations, tasks, performance, billing (statements, invoices, payments), communications, support, dispatcher assignments, audit log, waitlist, settings, scheduled jobs. |
| Carrier portal | Onboarding with agreement acceptance evidence, approve/reject proposed loads, trucks and availability, lanes and minimum rates, documents, performance, statements, invoice payment, team, support, cancellation. |
| Billing | Immutable fee snapshots at completion, weekly statements (percentage or flat weekly per truck), invoices, manual payments and Stripe Checkout for the dispatch invoice only. |
| Security | Postgres Row Level Security on every table (tested), role guards, MFA for admins, audit log, rate limits, bot checks, CSP with nonces, signed short-lived document URLs, CSV injection protection, Sentry scrubbing, PII-free analytics. |
| Jobs | Document expiration reminders, weekly statements, invoice reminders, stale application follow-up, onboarding reminders, daily summary, failed email retries — idempotent, recorded in `job_runs`. |
| Lease-on | Prepared tables and readiness checklist; disabled by environment flag **and** database guard until real authority, filings and attorney-approved documents exist. |

## Stack

Next.js 16 (App Router, React 19, TypeScript strict) · Tailwind CSS 4 ·
Supabase (Postgres, Auth, Storage) · Zod · React Hook Form · Stripe · Resend ·
Sentry · PostHog · Vitest · Playwright + axe-core. Dependencies are pinned and
`pnpm-lock.yaml` is committed.

## Quick start (local)

Requirements: Node 22, pnpm 10, PostgreSQL 16 binaries (or Docker-free local
stack prerequisites — see [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)).

```bash
pnpm install
pnpm stack:start            # local Postgres + Supabase Auth + PostgREST + storage gateway + SMTP sink
cp .env.example .env.local  # then paste keys from .local-stack/env (see docs)
pnpm seed                   # fictional demo data
pnpm dev                    # http://localhost:3000
```

Demo accounts (fictional, local only): `admin@demo.example` / `DemoAdmin!2026`,
`dispatcher@demo.example` / `DemoDispatch!2026`,
`owner@northstar-demo.example` / `DemoCarrierA!2026`,
`owner@bluebonnet-demo.example` / `DemoCarrierB!2026`.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm typecheck` / `pnpm lint` | TypeScript strict, ESLint (zero warnings) |
| `pnpm test` | Unit tests (domain, security, email, compliance copy) |
| `pnpm test:db` | RLS, authorization and workflow tests against Postgres |
| `pnpm test:integration` | Server modules against the local stack with real user tokens |
| `pnpm test:e2e` | Playwright workflows + axe accessibility (desktop and mobile) |
| `pnpm check:rls` | Fails if any table lacks RLS/policies or a function is over-exposed |
| `pnpm check:hints` | Validates PostgREST embed constraint names |
| `pnpm check:contrast` | WCAG AA contrast of the design tokens |
| `pnpm audit:deps` | Fails on high/critical dependency advisories |
| `pnpm verify` | Typecheck, lint, hints, unit, RLS, DB and integration tests, then build (E2E, contrast and audit run separately) |
| `pnpm db:types` | Regenerate `src/lib/db/database.types.ts` |
| `pnpm seed` | Idempotent demo data (refuses production) |

## Known limitations

- Business details, agreement templates and legal pages are placeholders or
  drafts until you fill them in and an attorney approves them.
- Stripe, Resend, PostHog, Sentry and Turnstile run on development fallbacks
  locally (mock checkout, file outbox, no-op analytics). Test each live
  integration in a staging environment before launch.
- Operating authority, insurance and safety checks are manual: staff check
  FMCSA systems and record the result. There is no automated FMCSA lookup.
- Uploads are checked for type, size and file signature, but not scanned for
  malware.
- Loads are entered by dispatchers; there is no load-board or broker API
  integration.
- One business timezone drives statement weeks and date entry.
- There is no CI workflow in the repository yet; run `pnpm verify` and
  `pnpm test:e2e` before deploying.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Local development](docs/LOCAL_DEVELOPMENT.md)
- [Deployment: Vercel + Supabase, Stripe, Resend, cron, backups](docs/DEPLOYMENT.md)
- [Security model](docs/SECURITY.md)
- [Compliance invariants and their tests](docs/COMPLIANCE_INVARIANTS.md)
- [Items requiring attorney review](docs/LEGAL_REVIEW.md)
- [Lease-on: deferred scope and activation checklist](docs/LEASE_ON.md)

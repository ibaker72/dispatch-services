# Architecture

```
Browser ──► Next.js (Vercel)
             ├─ src/proxy.ts            nonce CSP, security headers, Supabase session refresh
             ├─ app/(marketing)         public site + carrier application (anonymous, draft cookie)
             ├─ app/(auth)              sign-in, magic link, reset, MFA, invitation acceptance
             ├─ app/dashboard           staff (requireStaff)      ─┐
             ├─ app/portal              carriers (requireCarrierUser)├─► Supabase (user JWT) ─► Postgres RLS
             ├─ app/api/documents       RLS read → signed URL     ─┘
             ├─ app/api/stripe|payments verified webhooks ───────────► service role (idempotent ledger writes)
             ├─ app/api/cron/[job]      bearer secret → job runner ─► service role (job_runs, dedupe keys)
             └─ app/api/exports         RLS-scoped CSV
Supabase: Postgres (schema, RLS, triggers, functions) · Auth (GoTrue, TOTP MFA) · Storage (private bucket)
Integrations: Resend (email) · Stripe (dispatch invoices only) · Sentry · PostHog
```

## Source layout

| Path | Contents |
| --- | --- |
| `supabase/migrations` | Schema, RLS policies, guard triggers, workflow functions, reference data, lease-on preparation |
| `src/config/business.ts` | Typed business configuration and placeholders |
| `src/lib/domain` | Pure logic shared with tests: money (bigint cents), fees, mileage, load workflow, lease-on gate, dates (business timezone), labels |
| `src/lib/auth`, `src/lib/supabase` | Session context, guards, clients (user / service role) |
| `src/lib/actions.ts` | Server Action wrapper: origin check, Zod validation, safe error mapping |
| `src/lib/applications`, `documents`, `invitations`, `loads`, `billing`, `payments`, `jobs` | Application services |
| `src/lib/email` | Templates (HTML + text), layout, delivery with outbox record and retries |
| `src/lib/security` | Redirects, CSP, rate limits, bot checks, file validation, CSV, tokens |
| `src/components` | UI kit (accessible primitives), app shell, dashboard/portal building blocks |
| `tests/unit`, `tests/db`, `tests/integration`, `e2e` | Test suites (see README) |
| `scripts` | Local stack, seed, RLS gate, type generation, contrast and hint checks |

## Key flows

1. **Application** — anonymous drafts keyed by a random token (httpOnly cookie,
   only its SHA-256 stored), autosave per step, uploads straight to private
   storage, submission with consent evidence → staff notification.
2. **Approval** — `approve_application()` atomically creates the organization,
   carrier, trucks, trailers, drivers, lanes, fee contract, attaches documents
   and opens an onboarding task; the owner receives a one-time invitation
   (token hash stored; Supabase Auth link via `/auth/confirm`).
3. **Onboarding** — owner accepts published agreements (evidence written
   server-side and validated by trigger), documents are reviewed, authority is
   verified; `carriers.status → active` is refused until the database checklist
   passes.
4. **Loads** — `create_load()` (atomic, RLS-applied) → opportunity → proposed
   (carrier notified) → carrier approves in the portal
   (`respond_to_proposed_load`) or staff record an off-portal decision with
   evidence → booked (truck, driver, rate, live approval required) → … →
   completed (paperwork required) → immutable fee snapshot.
5. **Billing** — weekly statements from fee snapshots (or flat weekly per active
   truck), credits/adjustments, issue → invoice; payments manual or Stripe
   Checkout → verified webhook → idempotent payment → receipt.
6. **Jobs** — cron → `runJob` (one run per key) → handlers with email/task
   dedupe keys.

## Rendering

The root layout reads the per-request CSP nonce, so pages render dynamically.
Private pages use `loading.tsx` skeletons; a record the user cannot access
renders the not-found page (RLS returns no row).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project conventions

- **Authorization is in Postgres.** Read and write with the signed-in user's
  client (`ctx.supabase`); RLS and guard triggers enforce access and workflow
  rules. Use the service role (`createSupabaseAdminClient`) only for the cases
  listed in docs/SECURITY.md, and only after an RLS-scoped read established
  ownership. New tables need RLS + policies (`pnpm check:rls`).
- **Server Actions** use `runFormAction(schema, formData, handler)` (or
  `runAction`) from `src/lib/actions.ts`, call `requireStaff`/`requireCarrierUser`
  inside the handler, and throw `DbError`/`AppError` for user-facing messages.
  Forms use `<ActionForm>` + `<FormField>` from `src/components/action-form.tsx`.
- **PostgREST embeds** with `table!constraint(...)` hints are checked by
  `pnpm check:hints`. PostgREST reads written rows back, so a write whose new row
  the caller cannot SELECT is refused — test such paths in `tests/integration`.
- **Money** uses bigint cents (`src/lib/domain/money.ts`); fee math must match
  the database (`tests/db/admin-workflows.test.ts` parity cases).
- **Dates**: business dates and weeks come from the operations timezone
  (`src/lib/domain/dates.ts`); datetime inputs are wall-clock in that zone.
- **Copy**: never claim licensing, guarantees, income, statistics or social
  proof; `tests/unit/compliance-copy.test.ts` enforces this.
- **Checks before committing**: `pnpm typecheck && pnpm lint && pnpm test`;
  with the local stack running also `pnpm test:db && pnpm test:integration`.

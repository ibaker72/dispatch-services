/**
 * Quality gate: verifies Row Level Security coverage against a migrated
 * database (the local stack by default).
 *
 * Fails when:
 *   - any table in `public` has RLS disabled;
 *   - a table has no policies and is not explicitly documented as
 *     service-only (COMMENT ON TABLE ... 'rls:service-only ...');
 *   - a policy grants access to `anon` on a table outside the public
 *     reference-data allowlist;
 *   - a SECURITY DEFINER function in `public` is executable by anon/PUBLIC;
 *   - a view in `public` does not use security_invoker;
 *   - the private document bucket is public or lacks a read policy.
 *
 * Usage: pnpm check:rls   (DATABASE_URL or .local-stack/env)
 */
import { Client } from "pg";
import { loadLocalStackEnv } from "../tests/support/env";

const ANON_READABLE = new Set(["equipment_types", "document_requirements", "fee_plans", "app_settings"]);

async function main() {
  loadLocalStackEnv();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const failures: string[] = [];

  const tables = await client.query<{ name: string; rls: boolean; comment: string | null; policies: number }>(`
    select c.relname as name, c.relrowsecurity as rls, obj_description(c.oid, 'pg_class') as comment,
           (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname`);

  for (const t of tables.rows) {
    if (!t.rls) failures.push(`RLS disabled: public.${t.name}`);
    if (t.policies === 0 && !(t.comment ?? "").startsWith("rls:service-only")) {
      failures.push(`No policies and not documented as service-only: public.${t.name}`);
    }
  }

  const anonPolicies = await client.query<{ tablename: string; policyname: string }>(`
    select tablename, policyname from pg_policies
    where schemaname = 'public' and ('anon' = any (roles) or 'public' = any (roles))`);
  for (const p of anonPolicies.rows) {
    if (!ANON_READABLE.has(p.tablename)) failures.push(`anon/public policy on non-reference table: ${p.tablename}.${p.policyname}`);
  }

  const anonGrants = await client.query<{ table_name: string; privilege_type: string }>(`
    select table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'`);
  for (const g of anonGrants.rows) {
    if (!ANON_READABLE.has(g.table_name) || g.privilege_type !== "SELECT") {
      failures.push(`anon has ${g.privilege_type} on public.${g.table_name}`);
    }
  }

  const definers = await client.query<{ name: string; anon: boolean; pub: boolean }>(`
    select p.oid::regprocedure::text as name,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef`);
  for (const f of definers.rows) {
    if (f.anon || f.pub) failures.push(`SECURITY DEFINER function executable by anon/PUBLIC: ${f.name}`);
  }

  const views = await client.query<{ name: string; options: string[] | null }>(`
    select c.relname as name, c.reloptions as options
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'`);
  for (const v of views.rows) {
    if (!(v.options ?? []).includes("security_invoker=true")) failures.push(`View without security_invoker: public.${v.name}`);
  }

  const bucket = await client.query<{ public: boolean }>(`select public from storage.buckets where id = 'carrier-documents'`);
  if (bucket.rowCount !== 1 || bucket.rows[0]?.public) failures.push("carrier-documents bucket missing or public");
  const storagePolicies = await client.query(
    `select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'carrier_documents_select'`,
  );
  if (storagePolicies.rowCount !== 1) failures.push("storage.objects read policy for carrier-documents missing");
  const storageWrites = await client.query<{ policyname: string }>(
    `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT'`,
  );
  for (const p of storageWrites.rows) failures.push(`Unexpected client write policy on storage.objects: ${p.policyname}`);

  await client.end();

  console.log(`Checked ${tables.rowCount} tables, ${definers.rowCount} security-definer functions, ${views.rowCount} views.`);
  if (failures.length) {
    console.error(`\nRLS check failed (${failures.length}):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("RLS check passed: every public table has RLS enabled and policy coverage.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

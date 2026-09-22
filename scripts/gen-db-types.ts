/**
 * Generates src/lib/db/database.types.ts from the migrated local database in
 * the same shape `supabase gen types typescript` produces (Tables with Row /
 * Insert / Update / Relationships, Enums and Functions), so supabase-js
 * queries — including embedded joins — are fully typed.
 *
 * Usage: pnpm db:types   (requires the local stack or DATABASE_URL)
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { loadLocalStackEnv } from "../tests/support/env";

interface Column {
  table_name: string;
  column_name: string;
  udt_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_identity: "YES" | "NO";
  is_generated: "ALWAYS" | "NEVER";
}

const SCALARS: Record<string, string> = {
  uuid: "string",
  text: "string",
  citext: "string",
  varchar: "string",
  bpchar: "string",
  inet: "string",
  date: "string",
  timestamptz: "string",
  timestamp: "string",
  daterange: "string",
  interval: "string",
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "number",
  numeric: "number",
  float4: "number",
  float8: "number",
  jsonb: "Json",
  json: "Json",
  void: "undefined",
  record: "Json",
};

function tsType(udt: string, enums: Set<string>): string {
  if (udt.startsWith("_")) return `${tsType(udt.slice(1), enums)}[]`;
  if (enums.has(udt)) return `Database["public"]["Enums"]["${udt}"]`;
  return SCALARS[udt] ?? "unknown";
}

async function main() {
  loadLocalStackEnv();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const enumRows = await client.query<{ name: string; values: string[] }>(`
    select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as values
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' group by t.typname order by t.typname`);
  const enums = new Set(enumRows.rows.map((r) => r.name));

  const tables = await client.query<{ table_name: string }>(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);

  const columns = await client.query<Column>(`
    select table_name, column_name, udt_name, data_type, is_nullable, column_default, is_identity, is_generated
    from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`);

  const fks = await client.query<{
    name: string;
    table_name: string;
    columns: string[];
    ref_table: string;
    ref_columns: string[];
    one_to_one: boolean;
  }>(`
    select con.conname as name, rel.relname as table_name,
           array(select att.attname from unnest(con.conkey) with ordinality k(n, i) join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.n order by k.i)::text[] as columns,
           ref.relname as ref_table,
           array(select att.attname from unnest(con.confkey) with ordinality k(n, i) join pg_attribute att on att.attrelid = con.confrelid and att.attnum = k.n order by k.i)::text[] as ref_columns,
           exists (
             select 1 from pg_index ix
             where ix.indrelid = con.conrelid and ix.indisunique and ix.indpred is null
               and (select array_agg(x order by x) from unnest(ix.indkey::int2[]) x) = (select array_agg(x order by x) from unnest(con.conkey) x)
           ) as one_to_one
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
    order by rel.relname, con.conname`);

  const functions = await client.query<{
    name: string;
    arg_names: string[] | null;
    arg_types: string[];
    arg_defaults: number;
    returns: string;
    returns_set: boolean;
    table_cols: Array<{ name: string; type: string }> | null;
  }>(`
    select p.proname as name, p.proargnames as arg_names,
           array(select t.typname from unnest(p.proargtypes) with ordinality a(oid, i) join pg_type t on t.oid = a.oid order by a.i)::text[] as arg_types,
           p.pronargdefaults as arg_defaults,
           rt.typname as returns, p.proretset as returns_set,
           case when p.proargmodes is not null then (
             select json_agg(json_build_object('name', p.proargnames[i], 'type', t.typname) order by i)
             from generate_subscripts(p.proargmodes, 1) i join pg_type t on t.oid = p.proallargtypes[i]
             where p.proargmodes[i] = 't'
           ) end as table_cols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type rt on rt.oid = p.prorettype
    where n.nspname = 'public' and p.prokind = 'f' and rt.typname <> 'trigger'
      and has_function_privilege('authenticated', p.oid, 'execute') or (n.nspname = 'public' and p.proname = 'rate_limit_hit')
    order by p.proname`);

  await client.end();

  const byTable = new Map<string, Column[]>();
  for (const c of columns.rows) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
    byTable.get(c.table_name)!.push(c);
  }

  const out: string[] = [];
  out.push("// Generated by scripts/gen-db-types.ts — do not edit by hand. Run `pnpm db:types`.");
  out.push("");
  out.push("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
  out.push("");
  out.push("export type Database = {");
  out.push('  __InternalSupabase: { PostgrestVersion: "12.2" };');
  out.push("  public: {");
  out.push("    Tables: {");
  for (const { table_name } of tables.rows) {
    const cols = byTable.get(table_name) ?? [];
    out.push(`      ${table_name}: {`);
    out.push("        Row: {");
    for (const c of cols) {
      const t = tsType(c.udt_name, enums);
      out.push(`          ${c.column_name}: ${t}${c.is_nullable === "YES" ? " | null" : ""};`);
    }
    out.push("        };");
    for (const kind of ["Insert", "Update"] as const) {
      out.push(`        ${kind}: {`);
      for (const c of cols) {
        if (c.is_generated === "ALWAYS" || c.is_identity === "YES") {
          out.push(`          ${c.column_name}?: never;`);
          continue;
        }
        const optional = kind === "Update" || c.is_nullable === "YES" || c.column_default !== null;
        const t = tsType(c.udt_name, enums);
        out.push(`          ${c.column_name}${optional ? "?" : ""}: ${t}${c.is_nullable === "YES" ? " | null" : ""};`);
      }
      out.push("        };");
    }
    out.push("        Relationships: [");
    for (const fk of fks.rows.filter((f) => f.table_name === table_name)) {
      out.push("          {");
      out.push(`            foreignKeyName: "${fk.name}";`);
      out.push(`            columns: [${fk.columns.map((c) => `"${c}"`).join(", ")}];`);
      out.push(`            isOneToOne: ${fk.one_to_one};`);
      out.push(`            referencedRelation: "${fk.ref_table}";`);
      out.push(`            referencedColumns: [${fk.ref_columns.map((c) => `"${c}"`).join(", ")}];`);
      out.push("          },");
    }
    out.push("        ];");
    out.push("      };");
  }
  out.push("    };");
  out.push("    Views: { [_ in never]: never };");
  out.push("    Functions: {");
  for (const f of functions.rows) {
    const names = f.arg_names ?? [];
    const requiredCount = f.arg_types.length - f.arg_defaults;
    const args = f.arg_types.map((t, i) => `${names[i] ?? `arg${i}`}${i >= requiredCount ? "?" : ""}: ${tsType(t, enums)}`);
    let returns: string;
    if (f.table_cols && f.table_cols.length) {
      returns = `{ ${f.table_cols.map((c) => `${c.name}: ${tsType(c.type, enums)}`).join("; ")} }[]`;
    } else {
      returns = tsType(f.returns, enums) + (f.returns_set ? "[]" : "");
    }
    out.push(`      ${f.name}: { Args: { ${args.join("; ")} }; Returns: ${returns} };`);
  }
  out.push("    };");
  out.push("    Enums: {");
  for (const e of enumRows.rows) {
    out.push(`      ${e.name}: ${e.values.map((v) => `"${v}"`).join(" | ")};`);
  }
  out.push("    };");
  out.push("    CompositeTypes: { [_ in never]: never };");
  out.push("  };");
  out.push("};");
  out.push("");
  out.push('type PublicSchema = Database["public"];');
  out.push('export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];');
  out.push('export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];');
  out.push('export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];');
  out.push('export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];');
  out.push("");
  out.push("export const Constants = {");
  out.push("  public: {");
  out.push("    Enums: {");
  for (const e of enumRows.rows) {
    out.push(`      ${e.name}: [${e.values.map((v) => `"${v}"`).join(", ")}],`);
  }
  out.push("    },");
  out.push("  },");
  out.push("} as const;");
  out.push("");

  const target = path.join(process.cwd(), "src", "lib", "db", "database.types.ts");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out.join("\n"));
  console.log(`Wrote ${path.relative(process.cwd(), target)} (${tables.rowCount} tables, ${functions.rowCount} functions, ${enumRows.rowCount} enums)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

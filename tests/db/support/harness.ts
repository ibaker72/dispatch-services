/**
 * Database test harness.
 *
 * Reproduces what PostgREST does for each API request — `SET LOCAL ROLE` to
 * `anon`/`authenticated`/`service_role` and `request.jwt.claims` — against the
 * real migrated database, so these tests exercise the actual RLS policies,
 * triggers and functions that production runs.
 *
 * Every query runs inside a savepoint, so a rejected statement (the point of a
 * negative test) does not abort the surrounding transaction.
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type Actor =
  | { kind: "user"; id: string; aal?: "aal1" | "aal2"; label?: string }
  | { kind: "anon" }
  | { kind: "service" }
  | null; // null = direct database session (migrations, fixtures)

export const SYSTEM: Actor = null;
export const ANON: Actor = { kind: "anon" };
export const SERVICE: Actor = { kind: "service" };

export function user(id: string, aal: "aal1" | "aal2" = "aal1"): Actor {
  return { kind: "user", id, aal };
}

export class Tx {
  constructor(readonly client: PoolClient) {}

  private async applyActor(actor: Actor): Promise<void> {
    if (actor === null) return;
    if (actor.kind === "user") {
      const claims = { sub: actor.id, role: "authenticated", aud: "authenticated", aal: actor.aal ?? "aal1" };
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await this.client.query("set local role authenticated");
    } else if (actor.kind === "anon") {
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      await this.client.query("set local role anon");
    } else {
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: "service_role" }),
      ]);
      await this.client.query("set local role service_role");
    }
  }

  async query<R extends QueryResultRow = QueryResultRow>(actor: Actor, text: string, params: unknown[] = []) {
    await this.client.query("savepoint harness_q");
    try {
      await this.applyActor(actor);
      const result = await this.client.query<R>(text, params);
      await this.client.query("reset role");
      await this.client.query("select set_config('request.jwt.claims', '', true)");
      await this.client.query("release savepoint harness_q");
      return result;
    } catch (error) {
      await this.client.query("rollback to savepoint harness_q");
      throw error;
    }
  }

  async rows<R extends QueryResultRow = QueryResultRow>(actor: Actor, text: string, params: unknown[] = []) {
    return (await this.query<R>(actor, text, params)).rows;
  }

  async one<R extends QueryResultRow = QueryResultRow>(actor: Actor, text: string, params: unknown[] = []) {
    const rows = await this.rows<R>(actor, text, params);
    if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}: ${text}`);
    return rows[0]!;
  }

  async count(actor: Actor, text: string, params: unknown[] = []): Promise<number> {
    return (await this.query(actor, text, params)).rowCount ?? 0;
  }

  /** Asserts the statement is rejected; returns the error message. */
  async rejects(actor: Actor, text: string, params: unknown[] = [], pattern?: RegExp): Promise<string> {
    try {
      await this.query(actor, text, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (pattern && !pattern.test(message)) {
        throw new Error(`statement rejected with unexpected message "${message}" (expected ${pattern})`);
      }
      return message;
    }
    throw new Error(`expected statement to be rejected but it succeeded: ${text}`);
  }
}

/** Runs fn in a transaction that is always rolled back. */
export async function rollbackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    return await fn(new Tx(client));
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Runs fn in a transaction that is committed (used for shared fixtures). */
export async function commitTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(new Tx(client));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

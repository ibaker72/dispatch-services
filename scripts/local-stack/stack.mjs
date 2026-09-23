#!/usr/bin/env node
/**
 * Docker-free local backend used for database tests, integration tests and
 * Playwright E2E runs. It assembles the Supabase pieces this app uses:
 *
 *   Postgres (local binaries) ── GoTrue (supabase/auth) ── PostgREST
 *                         └──── gateway (/auth/v1, /rest/v1) ──── SMTP sink
 *
 * `supabase start` (Docker) remains the recommended day-to-day environment;
 * see docs/LOCAL_DEVELOPMENT.md. This script exists so the full verification
 * suite can run on machines and CI runners without Docker image access.
 *
 * Usage: node scripts/local-stack/stack.mjs <start|stop|reset|status|migrate|env>
 *
 * Everything binds to 127.0.0.1 and uses throwaway credentials. Never point
 * this at a real database.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const STACK = path.join(ROOT, ".local-stack");
const DIRS = {
  bin: path.join(STACK, "bin"),
  pgdata: path.join(STACK, "pgdata"),
  run: path.join(STACK, "run"),
  logs: path.join(STACK, "logs"),
  mail: path.join(STACK, "mail"),
  storage: path.join(STACK, "storage"),
  outbox: path.join(STACK, "outbox"),
};
const PORTS = { gateway: 54321, postgres: 54322, postgrest: 54323, auth: 54324, smtp: 54325 };
const VERSIONS = { postgrest: "12.2.12", auth: "2.178.0" };
const JWT_SECRET =
  process.env.LOCAL_STACK_JWT_SECRET ?? "local-stack-jwt-secret-for-tests-only-0123456789";
const SITE_URL = process.env.LOCAL_STACK_SITE_URL ?? "http://localhost:3000";
const EXTERNAL_DB_URL = process.env.LOCAL_STACK_DB_URL; // e.g. a CI Postgres service
const DB_URL = EXTERNAL_DB_URL ?? `postgres://postgres:postgres@127.0.0.1:${PORTS.postgres}/postgres`;
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

function log(msg) {
  console.log(`[local-stack] ${msg}`);
}

function ensureDirs() {
  for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
}

function pgBinDir() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  try {
    return execFileSync("pg_config", ["--bindir"]).toString().trim();
  } catch {
    throw new Error("Postgres binaries not found. Install PostgreSQL 15+ or set PG_BIN.");
  }
}

/** Run a Postgres server binary, dropping to the postgres user when running as root. */
function runPg(binary, args, opts = {}) {
  const bin = path.join(pgBinDir(), binary);
  const [cmd, argv] = IS_ROOT ? ["runuser", ["-u", "postgres", "--", bin, ...args]] : [bin, args];
  const res = spawnSync(cmd, argv, { stdio: opts.stdio ?? "pipe", encoding: "utf8" });
  if (res.status !== 0 && !opts.allowFail) {
    throw new Error(`${binary} ${args.join(" ")} failed:\n${res.stdout}\n${res.stderr}`);
  }
  return res;
}

function psql(args, input) {
  const res = spawnSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-q", ...args], {
    encoding: "utf8",
    input,
  });
  if (res.status !== 0) throw new Error(`psql failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

function download(url, dest) {
  log(`downloading ${url}`);
  const res = spawnSync("curl", ["-fsSL", "--retry", "4", "-o", dest, url], { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`download failed: ${url}`);
}

function ensureBinaries() {
  const postgrest = path.join(DIRS.bin, "postgrest");
  if (!fs.existsSync(postgrest)) {
    const tarball = path.join(DIRS.bin, "postgrest.tar.xz");
    download(
      `https://github.com/PostgREST/postgrest/releases/download/v${VERSIONS.postgrest}/postgrest-v${VERSIONS.postgrest}-linux-static-x86-64.tar.xz`,
      tarball,
    );
    execFileSync("tar", ["-xJf", tarball, "-C", DIRS.bin]);
    fs.rmSync(tarball);
  }
  const authDir = path.join(DIRS.bin, "auth");
  if (!fs.existsSync(path.join(authDir, "auth"))) {
    fs.mkdirSync(authDir, { recursive: true });
    const tarball = path.join(DIRS.bin, "auth.tar.gz");
    download(
      `https://github.com/supabase/auth/releases/download/v${VERSIONS.auth}/auth-v${VERSIONS.auth}-x86.tar.gz`,
      tarball,
    );
    execFileSync("tar", ["-xzf", tarball, "-C", authDir]);
    fs.rmSync(tarball);
  }
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function apiKeys() {
  const iat = 1735689600; // fixed so keys are stable between runs
  const exp = 2051222400;
  return {
    anon: signJwt({ iss: "local-stack", role: "anon", iat, exp }),
    serviceRole: signJwt({ iss: "local-stack", role: "service_role", iat, exp }),
  };
}

function pidFile(name) {
  return path.join(DIRS.run, `${name}.pid`);
}

function isRunning(name) {
  try {
    const pid = Number(fs.readFileSync(pidFile(name), "utf8"));
    process.kill(pid, 0);
    return pid;
  } catch {
    return 0;
  }
}

function startDaemon(name, cmd, args, env = {}, cwd = ROOT) {
  if (isRunning(name)) return;
  const out = fs.openSync(path.join(DIRS.logs, `${name}.log`), "a");
  const child = spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, ...env },
  });
  child.unref();
  fs.writeFileSync(pidFile(name), String(child.pid));
}

function stopDaemon(name) {
  const pid = isRunning(name);
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(pidFile(name), { force: true });
}

function waitForPort(port, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`${label} did not start on :${port}`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function waitForHttp(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not become healthy at ${url}`);
}

async function startPostgres() {
  if (EXTERNAL_DB_URL) {
    log("using external database from LOCAL_STACK_DB_URL");
    return;
  }
  if (IS_ROOT) {
    execFileSync("chown", ["-R", "postgres", DIRS.pgdata, DIRS.run]);
  }
  if (!fs.existsSync(path.join(DIRS.pgdata, "PG_VERSION"))) {
    log("initialising Postgres cluster");
    runPg("initdb", ["-D", DIRS.pgdata, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--locale=C.UTF-8"]);
  }
  const status = runPg("pg_ctl", ["-D", DIRS.pgdata, "status"], { allowFail: true });
  if (status.status !== 0) {
    log("starting Postgres");
    const logFile = path.join(DIRS.logs, "postgres.log");
    if (IS_ROOT) {
      fs.closeSync(fs.openSync(logFile, "a"));
      execFileSync("chown", ["postgres", logFile]);
    }
    runPg("pg_ctl", [
      "-D",
      DIRS.pgdata,
      "-l",
      logFile,
      "-w",
      "-o",
      `-p ${PORTS.postgres} -k ${DIRS.run} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200 -c timezone=UTC`,
      "start",
    ]);
  }
  await waitForPort(PORTS.postgres, "postgres");
}

function stopPostgres() {
  if (EXTERNAL_DB_URL || !fs.existsSync(path.join(DIRS.pgdata, "PG_VERSION"))) return;
  runPg("pg_ctl", ["-D", DIRS.pgdata, "-m", "fast", "stop"], { allowFail: true });
}

function bootstrapDatabase() {
  psql(["-f", path.join(import.meta.dirname, "bootstrap.sql")]);
}

function authEnv() {
  return {
    GOTRUE_API_HOST: "127.0.0.1",
    PORT: String(PORTS.auth),
    API_EXTERNAL_URL: `http://127.0.0.1:${PORTS.gateway}/auth/v1`,
    GOTRUE_DB_DRIVER: "postgres",
    GOTRUE_DB_DATABASE_URL: DB_URL.replace("postgres:postgres@", "supabase_auth_admin:postgres@"),
    GOTRUE_DB_NAMESPACE: "auth",
    GOTRUE_DB_MIGRATIONS_PATH: path.join(DIRS.bin, "auth", "migrations"),
    GOTRUE_SITE_URL: SITE_URL,
    GOTRUE_URI_ALLOW_LIST: `${SITE_URL}/**,http://127.0.0.1:3000/**`,
    GOTRUE_DISABLE_SIGNUP: "true",
    GOTRUE_JWT_SECRET: JWT_SECRET,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "false",
    GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED: "true",
    GOTRUE_SMTP_HOST: "127.0.0.1",
    GOTRUE_SMTP_PORT: String(PORTS.smtp),
    GOTRUE_SMTP_ADMIN_EMAIL: "auth@local-stack.test",
    GOTRUE_SMTP_SENDER_NAME: "Local Auth",
    GOTRUE_SMTP_MAX_FREQUENCY: "1s",
    GOTRUE_MAILER_OTP_EXP: "3600",
    GOTRUE_PASSWORD_MIN_LENGTH: "12",
    GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true",
    GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true",
    GOTRUE_MFA_MAX_ENROLLED_FACTORS: "10",
    GOTRUE_RATE_LIMIT_EMAIL_SENT: "10000",
    GOTRUE_RATE_LIMIT_VERIFY: "10000",
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "10000",
    GOTRUE_RATE_LIMIT_OTP: "10000",
    GOTRUE_RATE_LIMIT_SSO: "10000",
    GOTRUE_RATE_LIMIT_ANONYMOUS_USERS: "10000",
    GOTRUE_LOG_LEVEL: "warn",
    GOTRUE_MAILER_URLPATHS_INVITE: "/auth/v1/verify",
    GOTRUE_MAILER_URLPATHS_CONFIRMATION: "/auth/v1/verify",
    GOTRUE_MAILER_URLPATHS_RECOVERY: "/auth/v1/verify",
    GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: "/auth/v1/verify",
    // Same token-hash templates documented for hosted Supabase (supabase/templates).
    GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: `http://127.0.0.1:${PORTS.gateway}/templates/magic_link.html`,
    GOTRUE_MAILER_TEMPLATES_RECOVERY: `http://127.0.0.1:${PORTS.gateway}/templates/recovery.html`,
    GOTRUE_MAILER_TEMPLATES_INVITE: `http://127.0.0.1:${PORTS.gateway}/templates/invite.html`,
    GOTRUE_MAILER_TEMPLATES_CONFIRMATION: `http://127.0.0.1:${PORTS.gateway}/templates/confirmation.html`,
    GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE: `http://127.0.0.1:${PORTS.gateway}/templates/email_change.html`,
    GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: "Your sign-in link",
    GOTRUE_MAILER_SUBJECTS_RECOVERY: "Reset your password",
    GOTRUE_MAILER_SUBJECTS_INVITE: "You have been invited",
    GOTRUE_MAILER_SUBJECTS_CONFIRMATION: "Confirm your email",
    GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE: "Confirm your new email",
  };
}

function migrateAuth() {
  const bin = path.join(DIRS.bin, "auth", "auth");
  const res = spawnSync(bin, ["migrate"], {
    env: { ...process.env, ...authEnv() },
    cwd: path.join(DIRS.bin, "auth"),
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`auth migrate failed:\n${res.stdout}\n${res.stderr}`);
}

function applyAppMigrations() {
  psql([], `
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      name text,
      applied_at timestamptz not null default now()
    );
  `);
  const applied = new Set(
    psql(["-At", "-c", "select version from supabase_migrations.schema_migrations"])
      .split("\n")
      .filter(Boolean),
  );
  const dir = path.join(ROOT, "supabase", "migrations");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
  let count = 0;
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    psql(
      ["--single-transaction"],
      `${sql}\n;insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${rest.join("_")}');`,
    );
    count += 1;
    log(`applied migration ${file}`);
  }
  psql(["-c", "notify pgrst, 'reload schema'"]);
  return count;
}

function writePostgrestConfig() {
  const conf = path.join(DIRS.run, "postgrest.conf");
  fs.writeFileSync(
    conf,
    [
      `db-uri = "${DB_URL.replace("postgres:postgres@", "authenticator:postgres@")}"`,
      `db-schemas = "public"`,
      `db-anon-role = "anon"`,
      `db-extra-search-path = "public, extensions"`,
      `db-pool = 20`,
      `db-max-rows = 1000`,
      `jwt-secret = "${JWT_SECRET}"`,
      `server-host = "127.0.0.1"`,
      `server-port = ${PORTS.postgrest}`,
      `log-level = "warn"`,
    ].join("\n"),
  );
  return conf;
}

function envFileContents() {
  const keys = apiKeys();
  return [
    "# Generated by scripts/local-stack/stack.mjs — local test credentials only.",
    `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PORTS.gateway}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${keys.anon}`,
    `SUPABASE_SERVICE_ROLE_KEY=${keys.serviceRole}`,
    `DATABASE_URL=${DB_URL}`,
    `LOCAL_STACK_MAIL_DIR=${DIRS.mail}`,
    `LOCAL_STORAGE_DIR=${DIRS.storage}`,
    `EMAIL_DEV_OUTBOX_DIR=${DIRS.outbox}`,
    // Lets integration tests mint short-lived user tokens for the local stack only.
    `LOCAL_STACK_JWT_SECRET=${JWT_SECRET}`,
    "",
  ].join("\n");
}

async function start() {
  ensureDirs();
  ensureBinaries();
  await startPostgres();
  bootstrapDatabase();
  migrateAuth();
  const count = applyAppMigrations();
  log(`${count} new app migration(s) applied`);

  startDaemon("smtp", process.execPath, [path.join(import.meta.dirname, "smtp-sink.mjs")], {
    SMTP_SINK_PORT: String(PORTS.smtp),
    SMTP_SINK_DIR: DIRS.mail,
  });
  startDaemon("gateway", process.execPath, [path.join(import.meta.dirname, "gateway.mjs")], {
    GATEWAY_PORT: String(PORTS.gateway),
    GATEWAY_AUTH_URL: `http://127.0.0.1:${PORTS.auth}`,
    GATEWAY_REST_URL: `http://127.0.0.1:${PORTS.postgrest}`,
    GATEWAY_TEMPLATES_DIR: path.join(ROOT, "supabase", "templates"),
  });
  await waitForHttp(`http://127.0.0.1:${PORTS.gateway}/health`, "gateway");
  startDaemon("auth", path.join(DIRS.bin, "auth", "auth"), ["serve"], authEnv(), path.join(DIRS.bin, "auth"));
  startDaemon("postgrest", path.join(DIRS.bin, "postgrest"), [writePostgrestConfig()]);

  await waitForPort(PORTS.smtp, "smtp sink");
  await waitForHttp(`http://127.0.0.1:${PORTS.auth}/health`, "auth");
  await waitForHttp(`http://127.0.0.1:${PORTS.postgrest}/`, "postgrest");
  await waitForHttp(`http://127.0.0.1:${PORTS.gateway}/health`, "gateway");

  fs.writeFileSync(path.join(STACK, "env"), envFileContents());
  log(`ready — gateway http://127.0.0.1:${PORTS.gateway}, postgres ${DB_URL}`);
  log(`environment written to ${path.relative(ROOT, path.join(STACK, "env"))}`);
}

function stop() {
  for (const name of ["gateway", "postgrest", "auth", "smtp"]) stopDaemon(name);
  stopPostgres();
  log("stopped");
}

async function reset() {
  stop();
  await new Promise((r) => setTimeout(r, 500));
  for (const dir of ["pgdata", "mail", "storage", "outbox", "logs", "run"]) {
    fs.rmSync(DIRS[dir], { recursive: true, force: true });
  }
  if (EXTERNAL_DB_URL) {
    psql([], "drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists supabase_migrations cascade;");
  }
  await start();
}

function status() {
  for (const name of ["smtp", "auth", "postgrest", "gateway"]) {
    log(`${name.padEnd(10)} ${isRunning(name) ? "running" : "stopped"}`);
  }
  if (!EXTERNAL_DB_URL) {
    const res = runPg("pg_ctl", ["-D", DIRS.pgdata, "status"], { allowFail: true });
    log(`${"postgres".padEnd(10)} ${res.status === 0 ? "running" : "stopped"}`);
  }
}

const command = process.argv[2] ?? "status";
const commands = {
  start,
  stop,
  reset,
  status,
  migrate: () => {
    const count = applyAppMigrations();
    log(`${count} new app migration(s) applied`);
  },
  env: () => process.stdout.write(envFileContents()),
};

if (!commands[command]) {
  console.error(`Unknown command "${command}". Use one of: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

Promise.resolve(commands[command]()).catch((err) => {
  console.error(`[local-stack] ${err.message}`);
  process.exit(1);
});

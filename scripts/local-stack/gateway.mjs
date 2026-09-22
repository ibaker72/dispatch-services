/**
 * Minimal API gateway standing in for Supabase's Kong layer in the local stack:
 *   /auth/v1/*  -> GoTrue
 *   /rest/v1/*  -> PostgREST
 * Local test use only; binds to 127.0.0.1.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TEMPLATES_DIR = process.env.GATEWAY_TEMPLATES_DIR;
const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const ROUTES = [
  { prefix: "/auth/v1", target: new URL(process.env.GATEWAY_AUTH_URL ?? "http://127.0.0.1:54324") },
  { prefix: "/rest/v1", target: new URL(process.env.GATEWAY_REST_URL ?? "http://127.0.0.1:54323") },
];

const CORS_HEADERS = {
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers":
    "authorization,apikey,content-type,x-client-info,prefer,range,accept-profile,content-profile,x-upsert,x-supabase-api-version",
  "access-control-expose-headers": "content-range,content-location",
  "access-control-max-age": "600",
};

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const cors = origin ? { ...CORS_HEADERS, "access-control-allow-origin": origin, vary: "origin" } : {};

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end('{"ok":true}');
    return;
  }

  if (TEMPLATES_DIR && req.url.startsWith("/templates/")) {
    const name = path.basename(req.url.split("?")[0]);
    const file = path.join(TEMPLATES_DIR, name);
    if (/^[a-z_]+\.html$/.test(name) && fs.existsSync(file)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(file));
      return;
    }
  }

  const route = ROUTES.find((r) => req.url === r.prefix || req.url.startsWith(`${r.prefix}/`) || req.url.startsWith(`${r.prefix}?`));
  if (!route) {
    res.writeHead(404, { "content-type": "application/json", ...cors });
    res.end('{"error":"not_found"}');
    return;
  }

  const upstreamPath = req.url.slice(route.prefix.length) || "/";
  const headers = { ...req.headers, host: route.target.host };
  delete headers["accept-encoding"];

  const upstream = http.request(
    {
      hostname: route.target.hostname,
      port: route.target.port,
      method: req.method,
      path: upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`,
      headers: { ...headers, "x-forwarded-host": req.headers.host ?? "", "x-forwarded-proto": "http" },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, { ...upRes.headers, ...cors });
      upRes.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ error: "bad_gateway", message: err.message }));
  });
  req.pipe(upstream);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[gateway] listening on 127.0.0.1:${PORT}`);
});

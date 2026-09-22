/**
 * Tiny SMTP sink for the local stack. Accepts every message GoTrue sends
 * (magic links, password resets, email confirmations) and writes it to
 * SMTP_SINK_DIR as JSON so tests and developers can read the links.
 * Local test use only; binds to 127.0.0.1 and never relays mail.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const PORT = Number(process.env.SMTP_SINK_PORT ?? 54325);
const DIR = process.env.SMTP_SINK_DIR ?? path.resolve(".local-stack/mail");
fs.mkdirSync(DIR, { recursive: true });

function decodeQuotedPrintable(input) {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseMessage(raw) {
  const [head, ...bodyParts] = raw.split(/\r?\n\r?\n/);
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
  }
  let body = bodyParts.join("\n\n");
  if (/quoted-printable/i.test(raw)) body = decodeQuotedPrintable(body);
  if (/base64/i.test(headers["content-transfer-encoding"] ?? "")) {
    body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  body = body.replace(/&amp;/g, "&");
  const links = [...new Set(body.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
  return { to: headers.to ?? "", subject: headers.subject ?? "", body, links };
}

const server = net.createServer((socket) => {
  let buffer = "";
  let inData = false;
  let data = [];
  const reply = (line) => socket.write(`${line}\r\n`);
  reply("220 local-stack ESMTP sink");

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          const raw = data.join("\r\n");
          data = [];
          const msg = { ...parseMessage(raw), receivedAt: new Date().toISOString() };
          const file = path.join(DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
          fs.writeFileSync(file, JSON.stringify(msg, null, 2));
          reply("250 OK queued");
        } else {
          data.push(line.startsWith("..") ? line.slice(1) : line);
        }
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO") {
        reply("250-local-stack");
        reply("250-8BITMIME");
        reply("250 SIZE 10485760");
      } else if (cmd === "HELO") reply("250 local-stack");
      else if (cmd === "MAIL" || cmd === "RCPT" || cmd === "RSET" || cmd === "NOOP") reply("250 OK");
      else if (cmd === "DATA") {
        inData = true;
        reply("354 End data with <CR><LF>.<CR><LF>");
      } else if (cmd === "QUIT") {
        reply("221 Bye");
        socket.end();
      } else reply("502 Command not implemented");
    }
  });
  socket.on("error", () => socket.destroy());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[smtp-sink] listening on 127.0.0.1:${PORT}, writing to ${DIR}`);
});

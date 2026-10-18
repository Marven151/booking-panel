import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as core from "./docs/core.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(ROOT, "docs");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const today = () => new Date().toISOString().slice(0, 10);

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      guests INTEGER NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new'
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

function busyRanges(db) {
  const confirmed = db.prepare("SELECT start, end FROM requests WHERE status = 'confirmed'").all();
  const blocks = db.prepare("SELECT start, end FROM blocks").all();
  return [...confirmed, ...blocks].map((r) => ({ start: r.start, end: r.end }));
}

class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

function readJson(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "Zbyt duże zapytanie."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Niepoprawny JSON."));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(data);
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function createApp({ dbPath = ":memory:", adminPassword }) {
  if (!adminPassword) throw new Error("adminPassword is required");
  const db = openDb(dbPath);
  const tokens = new Map();
  const hits = new Map();

  function limited(key, max, windowMs) {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    return list.length > max;
  }

  function requireAdmin(req) {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const exp = tokens.get(token);
    if (!exp || exp < Date.now()) throw new HttpError(401, "Zaloguj się ponownie.");
  }

  const getRequest = (id) => db.prepare("SELECT * FROM requests WHERE id = ?").get(id);

  async function api(req, res, url) {
    const ip = req.socket.remoteAddress ?? "unknown";
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /api/health") return send(res, 200, { ok: true, mode: "server" });
    if (route === "GET /api/busy") return send(res, 200, { busy: busyRanges(db) });

    if (route === "POST /api/requests") {
      if (limited(`req:${ip}`, 10, 60_000)) throw new HttpError(429, "Za dużo zapytań, spróbuj za minutę.");
      const body = await readJson(req);
      const v = core.validateRequest(body, today());
      if (!v.ok) throw new HttpError(422, "Popraw zaznaczone pola.", v.errors);
      if (!core.isFree(v.clean.start, v.clean.end, busyRanges(db))) {
        throw new HttpError(409, "Ten termin jest już zajęty.", { dates: "Ten termin jest już zajęty." });
      }
      const total = core.priceFor(v.clean.start, v.clean.end).total;
      const info = db
        .prepare(
          "INSERT INTO requests (created_at, start, end, name, email, phone, guests, message, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(new Date().toISOString(), v.clean.start, v.clean.end, v.clean.name, v.clean.email, v.clean.phone, v.clean.guests, v.clean.message, total);
      return send(res, 201, { id: Number(info.lastInsertRowid), total });
    }

    if (route === "POST /api/admin/login") {
      if (limited(`login:${ip}`, 5, 60_000)) throw new HttpError(429, "Za dużo prób logowania.");
      const body = await readJson(req);
      if (!safeEqual(body.password ?? "", adminPassword)) throw new HttpError(401, "Złe hasło.");
      const token = crypto.randomBytes(24).toString("hex");
      tokens.set(token, Date.now() + 8 * 3600_000);
      return send(res, 200, { token });
    }

    if (url.pathname.startsWith("/api/admin/")) {
      requireAdmin(req);

      if (route === "GET /api/admin/requests") {
        return send(res, 200, { requests: db.prepare("SELECT * FROM requests ORDER BY id DESC").all() });
      }

      const status = /^\/api\/admin\/requests\/(\d+)\/status$/.exec(url.pathname);
      if (status && req.method === "POST") {
        const id = Number(status[1]);
        const next = (await readJson(req)).status;
        if (!["confirmed", "declined"].includes(next)) throw new HttpError(422, "Nieznany status.");
        const row = getRequest(id);
        if (!row) throw new HttpError(404, "Nie ma takiego zapytania.");
        if (next === "confirmed") {
          const others = db
            .prepare("SELECT start, end FROM requests WHERE status = 'confirmed' AND id != ?")
            .all(id)
            .concat(db.prepare("SELECT start, end FROM blocks").all());
          if (!core.isFree(row.start, row.end, others)) throw new HttpError(409, "Termin koliduje z inną rezerwacją lub blokadą.");
        }
        db.prepare("UPDATE requests SET status = ? WHERE id = ?").run(next, id);
        return send(res, 200, { request: getRequest(id) });
      }

      if (route === "GET /api/admin/blocks") {
        return send(res, 200, { blocks: db.prepare("SELECT * FROM blocks ORDER BY start").all() });
      }

      if (route === "POST /api/admin/blocks") {
        const b = await readJson(req);
        const s = core.parseISO(b.start);
        const e = core.parseISO(b.end);
        if (!s || !e || b.end <= b.start) throw new HttpError(422, "Podaj poprawny zakres dat.");
        const note = String(b.note ?? "").trim().slice(0, 80);
        const info = db.prepare("INSERT INTO blocks (start, end, note) VALUES (?, ?, ?)").run(b.start, b.end, note);
        return send(res, 201, { id: Number(info.lastInsertRowid) });
      }

      const block = /^\/api\/admin\/blocks\/(\d+)$/.exec(url.pathname);
      if (block && req.method === "DELETE") {
        db.prepare("DELETE FROM blocks WHERE id = ?").run(Number(block[1]));
        return send(res, 200, { ok: true });
      }
    }

    throw new HttpError(404, "Nie znaleziono.");
  }

  function serveStatic(req, res, url) {
    const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(DOCS, rel));
    if (!file.startsWith(DOCS + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Nie znaleziono.");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Metoda niedozwolona.");
      return serveStatic(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, errors: e.errors });
      console.error(e);
      return send(res, 500, { error: "Błąd serwera." });
    }
  });
  server.on("close", () => db.close());
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "demo";
  if (!process.env.ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD not set, using the demo password 'demo'");
  const port = Number(process.env.PORT ?? 3000);
  createApp({ dbPath: process.env.DB_PATH ?? "booking.db", adminPassword }).listen(port, () => {
    console.log(`http://localhost:${port}  (owner panel: /admin.html)`);
  });
}

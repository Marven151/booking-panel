import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

async function start() {
  const server = createApp({ adminPassword: "secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { server, call };
}

const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const guest = (start, end) => ({ start, end, name: "Anna Nowak", email: "anna@example.com", guests: 4 });

test("a guest request is stored and priced on the server", async () => {
  const { server, call } = await start();
  const r = await call("POST", "/api/requests", guest(future(30), future(33)));
  assert.equal(r.status, 201);
  assert.ok(r.body.total >= 2700);
  server.close();
});

test("invalid requests are rejected with field errors", async () => {
  const { server, call } = await start();
  const r = await call("POST", "/api/requests", { start: future(30), end: future(29), name: "", email: "x", guests: 99 });
  assert.equal(r.status, 422);
  assert.ok(r.body.errors.email);
  server.close();
});

test("admin routes need a login", async () => {
  const { server, call } = await start();
  assert.equal((await call("GET", "/api/admin/requests")).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { password: "wrong" })).status, 401);
  server.close();
});

test("confirming a request blocks the dates for other guests", async () => {
  const { server, call } = await start();
  const { body: { token } } = await call("POST", "/api/admin/login", { password: "secret" });
  const created = await call("POST", "/api/requests", guest(future(40), future(44)));
  const id = created.body.id;
  assert.equal((await call("GET", "/api/busy")).body.busy.length, 0);
  const ok = await call("POST", `/api/admin/requests/${id}/status`, { status: "confirmed" }, token);
  assert.equal(ok.status, 200);
  assert.equal((await call("GET", "/api/busy")).body.busy.length, 1);
  const clash = await call("POST", "/api/requests", guest(future(42), future(46)));
  assert.equal(clash.status, 409);
  const after = await call("POST", "/api/requests", guest(future(44), future(47)));
  assert.equal(after.status, 201);
  server.close();
});

test("two pending requests for the same dates cannot both be confirmed", async () => {
  const { server, call } = await start();
  const { body: { token } } = await call("POST", "/api/admin/login", { password: "secret" });
  const a = await call("POST", "/api/requests", guest(future(60), future(64)));
  const b = await call("POST", "/api/requests", guest(future(61), future(65)));
  assert.equal((await call("POST", `/api/admin/requests/${a.body.id}/status`, { status: "confirmed" }, token)).status, 200);
  assert.equal((await call("POST", `/api/admin/requests/${b.body.id}/status`, { status: "confirmed" }, token)).status, 409);
  server.close();
});

test("owner blocks make dates unavailable and can be removed", async () => {
  const { server, call } = await start();
  const { body: { token } } = await call("POST", "/api/admin/login", { password: "secret" });
  const blk = await call("POST", "/api/admin/blocks", { start: future(80), end: future(84), note: "remont" }, token);
  assert.equal(blk.status, 201);
  assert.equal((await call("POST", "/api/requests", guest(future(81), future(83)))).status, 409);
  await call("DELETE", `/api/admin/blocks/${blk.body.id}`, null, token);
  assert.equal((await call("POST", "/api/requests", guest(future(81), future(83)))).status, 201);
  server.close();
});

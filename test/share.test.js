import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

// The share store, served for real on an ephemeral port: streamed to disk,
// bounded by the free space, refused before the body when it cannot fit.

const dir = mkdtempSync(join(tmpdir(), "share-test-"));
process.env.SHARE_DIR = join(dir, "store");
// A fixed 1 MB budget, so the queue can be driven without filling a disk.
process.env.SHARE_CAPACITY_BYTES = String(1_000_000);
process.env.SHARE_DISK_MARGIN_BYTES = "0";
const { shareRouter } = await import("../src/routes/share.js");

let server;
let base;

before(async () => {
  const app = express();
  app.use("/share", shareRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A raw request, for the cases fetch would not send (a size it does not
 *  keep, no size at all). */
function raw(path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method: "POST", headers }, (res) => {
      let text = "";
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("capacity reports a byte count", async () => {
  const res = await fetch(`${base}/share/capacity`);
  assert.equal(res.status, 200);
  const { availableBytes } = await res.json();
  assert.equal(typeof availableBytes, "number");
  assert.ok(availableBytes >= 0);
});

test("an upload comes back byte for byte", async () => {
  const bytes = new Uint8Array(300_000).map((_, i) => (i * 7) % 256);
  const up = await fetch(`${base}/share/upload`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
  assert.equal(up.status, 200);
  const { key, secondsRemaining } = await up.json();
  assert.match(key, /^[A-Z0-9]{6}$/);
  assert.equal(secondsRemaining, 600);

  const down = await fetch(`${base}/share/${key.toLowerCase()}`);
  assert.equal(down.status, 200);
  assert.equal(down.headers.get("content-length"), String(bytes.length));
  assert.deepEqual(new Uint8Array(await down.arrayBuffer()), bytes);
});

test("a body larger than the free space is refused before it is sent", async () => {
  const res = await raw("/share/upload", { "Content-Type": "application/octet-stream", "Content-Length": String(2 ** 52) });
  assert.equal(res.status, 413);
  assert.equal(res.body.error, "InsufficientSpace");
  assert.equal(typeof res.body.availableBytes, "number");
});

test("a body with no announced size is refused", async () => {
  const res = await raw("/share/upload", { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" }, "abc");
  assert.equal(res.status, 411);
});

test("?size= stands in for a missing Content-Length", async () => {
  const res = await raw("/share/upload?size=3", { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" }, "abc");
  assert.equal(res.status, 200);
  assert.match(res.body.key, /^[A-Z0-9]{6}$/);
});

test("an empty body is refused", async () => {
  const res = await raw("/share/upload", { "Content-Type": "application/octet-stream", "Content-Length": "0" });
  assert.equal(res.status, 400);
});

test("an unknown key is a 404", async () => {
  const res = await fetch(`${base}/share/ZZZZZZ`);
  assert.equal(res.status, 404);
});

// ── The queue. Held so far by the tests above: 300 000 + 3 bytes, of 1 MB. ──

async function call(method, path) {
  const res = await fetch(`${base}${path}`, { method });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

test("capacity says what fits now and what could ever fit", async () => {
  const { body } = await call("GET", "/share/capacity");
  assert.equal(body.maxBytes, 1_000_000);
  assert.equal(body.availableBytes, 1_000_000 - 300_003);
  assert.equal(body.waiting, 0);
});

test("an item larger than the whole store is refused, with the most it could take", async () => {
  const { status, body } = await call("POST", "/share/ticket?size=1000001");
  assert.equal(status, 413);
  assert.equal(body.error, "TooLarge");
  assert.equal(body.maxBytes, 1_000_000);
});

test("tickets are served in order of arrival, never skipped for a smaller one", async () => {
  const a = await call("POST", "/share/ticket?size=600000");
  assert.equal(a.body.status, "ready");

  // 99 997 bytes left: B waits, and so does C although C alone would fit.
  const b = await call("POST", "/share/ticket?size=200000");
  assert.equal(b.body.status, "waiting");
  assert.equal(b.body.position, 1);
  const c = await call("POST", "/share/ticket?size=50000");
  assert.equal(c.body.status, "waiting");
  assert.equal(c.body.position, 2);

  // Nobody jumps the queue without a ticket either.
  const direct = await raw("/share/upload", { "Content-Type": "application/octet-stream", "Content-Length": "10" }, "0123456789");
  assert.equal(direct.status, 413);

  // A gives up its room: B then C are granted, in that order.
  assert.equal((await call("DELETE", `/share/ticket/${a.body.ticket}`)).status, 204);
  assert.equal((await call("GET", `/share/ticket/${b.body.ticket}`)).body.status, "ready");
  assert.equal((await call("GET", `/share/ticket/${c.body.ticket}`)).body.status, "ready");

  // C uploads with its ticket; the ticket is spent by it.
  const bytes = new Uint8Array(50_000).fill(7);
  const up = await fetch(`${base}/share/upload?ticket=${c.body.ticket}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
  assert.equal(up.status, 200);
  const again = await fetch(`${base}/share/upload?ticket=${c.body.ticket}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
  assert.equal(again.status, 409);
  await call("DELETE", `/share/ticket/${b.body.ticket}`);
});

test("a ticket is only good for the size it was taken for", async () => {
  const t = await call("POST", "/share/ticket?size=100");
  assert.equal(t.body.status, "ready");
  const up = await raw(`/share/upload?ticket=${t.body.ticket}`, { "Content-Type": "application/octet-stream", "Content-Length": "5" }, "abcde");
  assert.equal(up.status, 409);
  await call("DELETE", `/share/ticket/${t.body.ticket}`);
});

test("an unknown ticket is a 404", async () => {
  assert.equal((await call("GET", "/share/ticket/nope")).status, 404);
});

import { Router } from "express";
import { randomBytes } from "crypto";
import { createReadStream, createWriteStream, mkdirSync, rmSync, promises as fsp } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export const shareRouter = Router();

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// ── Storage: on disk, bounded by the disk itself ──────────────────────────────
// Shared items used to be held in memory under a fixed 100 MB cap. A long
// recording (3 h 30 of audio ≈ 100 MB) went past the cap, and a few large
// items at once would have exhausted a small instance's RAM. They are now
// streamed to a temporary directory as they arrive, and the only limit is the
// free space on that disk, minus a margin kept for everything else, minus what
// uploads in progress have announced but not yet written.
//
// Same "best-effort" character as before: the directory is emptied on start,
// so a restart drops every shared item, exactly as the in-memory store did.
const DIR = process.env.SHARE_DIR || join(tmpdir(), "share-store");
const DISK_MARGIN_BYTES = process.env.SHARE_DISK_MARGIN_BYTES !== undefined
  ? Number(process.env.SHARE_DISK_MARGIN_BYTES) : 512 * 1024 * 1024;
/** Optional ceiling on what the store holds at once, under the disk's own. */
const CAPACITY_BYTES = process.env.SHARE_CAPACITY_BYTES !== undefined
  ? Number(process.env.SHARE_CAPACITY_BYTES) : Infinity;
const UPLOAD_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

/** @type {Map<string, { path: string, size: number, expiresAt: number }>} */
const store = new Map();
/** Uploads in progress: the size each announced, and how much of it is on disk
 *  already (counted by statfs, so only the rest is still owed).
 *  @type {Map<string, { expected: number, written: number }>} */
const inFlight = new Map();

function generateKey() {
  let key = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) key += CHARS[bytes[i] % CHARS.length];
  return key;
}

function purgeExpired() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
      // An item being downloaded right now is still read to the end: on
      // Linux, an unlinked file lives as long as it is open.
      fsp.unlink(entry.path).catch(() => {});
    }
  }
}
setInterval(purgeExpired, 60 * 1000).unref();

// ── The queue ──────────────────────────────────────────────────────────────────
// An item that does not fit now usually will soon: everything stored expires
// within TTL_MS. So rather than a refusal, a client takes a ticket and waits
// its turn. Tickets are served strictly in order of arrival — skipping to a
// smaller one that happens to fit would let a large item wait forever behind a
// stream of small ones. A granted ticket holds its room until the upload
// starts (or GRANT_HOLD_MS passes); a waiting one is forgotten when its client
// stops asking (TICKET_IDLE_MS). Only an item that could never fit, even on an
// empty store, is refused outright.
const TICKET_IDLE_MS = 60 * 1000;
const GRANT_HOLD_MS = 2 * 60 * 1000;

/** In order of arrival (a Map keeps insertion order).
 *  @type {Map<string, { size: number, lastSeen: number, grantedAt: number | null }>} */
const tickets = new Map();

function sweepTickets() {
  const now = Date.now();
  for (const [id, t] of tickets) {
    if (t.grantedAt !== null ? now - t.grantedAt > GRANT_HOLD_MS : now - t.lastSeen > TICKET_IDLE_MS) tickets.delete(id);
  }
}

/** Bytes promised but not yet on disk: the rest of each upload in progress,
 *  and the whole of each granted ticket. */
function owedBytes() {
  let owed = 0;
  for (const u of inFlight.values()) owed += Math.max(0, u.expected - u.written);
  for (const t of tickets.values()) if (t.grantedAt !== null) owed += t.size;
  return owed;
}

/** Bytes on disk: stored items, and what uploads in progress have written. */
function heldBytes() {
  let held = 0;
  for (const e of store.values()) held += e.size;
  for (const u of inFlight.values()) held += u.written;
  return held;
}

async function diskFreeBytes() {
  const s = await fsp.statfs(DIR);
  return s.bavail * s.bsize - DISK_MARGIN_BYTES;
}

/** Bytes a new upload may take right now. */
async function availableBytes() {
  const free = Math.min(await diskFreeBytes(), CAPACITY_BYTES - heldBytes());
  return Math.max(0, free - owedBytes());
}

/** The largest item the store could ever take: everything it holds now will
 *  have expired by then. */
async function maxBytes() {
  return Math.max(0, Math.min(await diskFreeBytes() + heldBytes(), CAPACITY_BYTES));
}

/** Grants the head of the queue, then the next, while they fit. Never past
 *  one that does not. */
async function grantTickets() {
  purgeExpired();
  sweepTickets();
  let free = await availableBytes();
  for (const t of tickets.values()) {
    if (t.grantedAt !== null) continue;
    if (t.size > free) break;
    t.grantedAt = Date.now();
    free -= t.size;
  }
}

function waitingCount() {
  let n = 0;
  for (const t of tickets.values()) if (t.grantedAt === null) n++;
  return n;
}

async function ticketStatus(id) {
  const t = tickets.get(id);
  if (t.grantedAt !== null) return { ticket: id, status: "ready" };
  let position = 1;
  for (const [other, o] of tickets) {
    if (other === id) break;
    if (o.grantedAt === null) position++;
  }
  return { ticket: id, status: "waiting", position, availableBytes: await availableBytes() };
}

// ── Defense in depth on GET /:key ──────────────────────────────────────────────
// The keyspace (36^6 ≈ 2.18B, 10 min TTL) already makes guessing impractical on
// its own, but a shared item can contain audio, so a per-IP rate limit costs
// little and closes off brute-force/scraping attempts entirely. In-memory only
// — same lifetime and "best-effort, resets on restart" character as the share
// store itself, no need for anything heavier here.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
/** @type {Map<string, { count: number, windowStart: number }>} */
const rateLimits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

function purgeStaleRateLimits() {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimits.delete(ip);
  }
}

/** How much a client may send right now — asked before an upload, so a
 *  too-large one is refused before a single byte leaves the client. */
shareRouter.get("/capacity", async (_req, res) => {
  try {
    await grantTickets();
    return res.json({ availableBytes: await availableBytes(), maxBytes: await maxBytes(), waiting: waitingCount() });
  } catch {
    return res.status(500).json({ error: "CapacityUnknown", message: "Free space could not be measured." });
  }
});

/** A place in the queue for an item of `?size=` bytes. Answered at once:
 *  `ready` (upload now, with `?ticket=`) or `waiting` (ask again with GET). */
shareRouter.post("/ticket", async (req, res) => {
  const size = Number(req.query.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    return res.status(400).json({ error: "InvalidSize", message: "?size= must be a positive number of bytes." });
  }
  try {
    const max = await maxBytes();
    if (size > max) {
      return res.status(413).json({ error: "TooLarge", message: "This item can never fit in the share store.", maxBytes: max });
    }
    const id = randomBytes(12).toString("base64url");
    tickets.set(id, { size, lastSeen: Date.now(), grantedAt: null });
    await grantTickets();
    return res.json(await ticketStatus(id));
  } catch {
    return res.status(500).json({ error: "CapacityUnknown", message: "Free space could not be measured." });
  }
});

/** Asking keeps a waiting ticket alive (TICKET_IDLE_MS). */
shareRouter.get("/ticket/:id", async (req, res) => {
  const t = tickets.get(req.params.id);
  if (!t) return res.status(404).json({ error: "TicketUnknown", message: "No such ticket, or it lapsed." });
  t.lastSeen = Date.now();
  try {
    await grantTickets();
    if (!tickets.has(req.params.id)) return res.status(404).json({ error: "TicketUnknown", message: "No such ticket, or it lapsed." });
    return res.json(await ticketStatus(req.params.id));
  } catch {
    return res.status(500).json({ error: "CapacityUnknown", message: "Free space could not be measured." });
  }
});

shareRouter.delete("/ticket/:id", (req, res) => {
  tickets.delete(req.params.id);
  return res.status(204).end();
});

/** The body is streamed to disk. Its size must be announced — Content-Length,
 *  or `?size=` when a proxy on the way drops it — and is checked BEFORE
 *  reading: a refusal costs the client nothing but the request line. With
 *  `?ticket=`, the room is the one its grant reserved; without, the item has
 *  to fit now AND nobody may be waiting — it does not jump the queue. */
shareRouter.post("/upload", async (req, res) => {
  purgeExpired();
  sweepTickets();

  const declared = Number(req.headers["content-length"] ?? req.query.size);
  if (!Number.isSafeInteger(declared) || declared < 0) {
    return res.status(411).json({ error: "LengthRequired", message: "The size of the body must be announced." });
  }
  if (declared === 0) {
    return res.status(400).json({ error: "EmptyBody", message: "Request body must not be empty." });
  }

  // The connection is closed after a refusal: Node would otherwise read (and
  // discard) the whole refused body before reusing it.
  const ticketId = typeof req.query.ticket === "string" ? req.query.ticket : null;
  if (ticketId !== null) {
    const t = tickets.get(ticketId);
    if (!t || t.grantedAt === null || t.size !== declared) {
      res.set("Connection", "close");
      return res.status(409).json({ error: "TicketNotReady", message: "This ticket is unknown, not granted yet, or for another size." });
    }
    // Its reservation becomes the upload's, below, in the same tick.
    tickets.delete(ticketId);
  } else {
    let available;
    try { available = await availableBytes(); } catch { available = 0; }
    if (declared > available || waitingCount() > 0) {
      res.set("Connection", "close");
      return res.status(413).json({
        error: "InsufficientSpace",
        message: "Not enough free space for this item right now.",
        availableBytes: available,
      });
    }
  }

  let key;
  let attempts = 0;
  do { key = generateKey(); attempts++; } while ((store.has(key) || inFlight.has(key)) && attempts < 10);

  const path = join(DIR, key);
  const partPath = `${path}.part`;
  const progress = { expected: declared, written: 0 };
  inFlight.set(key, progress);

  const out = createWriteStream(partPath);
  let failed = false;
  const fail = (status, body) => {
    if (failed) return;
    failed = true;
    inFlight.delete(key);
    req.unpipe(out);
    out.destroy();
    fsp.unlink(partPath).catch(() => {});
    if (!res.headersSent) {
      res.set("Connection", "close");
      res.status(status).json(body);
    }
  };

  req.on("data", (chunk) => {
    progress.written += chunk.length;
    // Announced one size, sending more: refused, or the space check meant nothing.
    if (progress.written > declared) {
      fail(413, { error: "SizeMismatch", message: "The body is larger than announced." });
      req.destroy();
    }
  });
  // A client that stops sending without closing would hold its reservation
  // forever: two minutes of silence end it.
  req.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => {
    fail(408, { error: "Timeout", message: "Upload stalled." });
    req.destroy();
  });
  req.on("aborted", () => fail(400, { error: "Aborted", message: "Upload interrupted." }));
  req.on("error", () => fail(400, { error: "Aborted", message: "Upload interrupted." }));
  out.on("error", () => fail(500, { error: "WriteFailed", message: "The item could not be stored." }));

  out.on("finish", async () => {
    if (failed) return;
    if (progress.written !== declared) {
      return fail(400, { error: "SizeMismatch", message: "The body is smaller than announced." });
    }
    try {
      await fsp.rename(partPath, path);
    } catch {
      return fail(500, { error: "WriteFailed", message: "The item could not be stored." });
    }
    inFlight.delete(key);
    const expiresAt = Date.now() + TTL_MS;
    store.set(key, { path, size: declared, expiresAt });
    res.json({ key, secondsRemaining: Math.floor(TTL_MS / 1000) });
  });

  req.pipe(out);
});

shareRouter.get("/:key", (req, res) => {
  purgeExpired();
  purgeStaleRateLimits();

  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: "TooManyRequests", message: "Too many requests. Please slow down." });
  }

  const key = req.params.key.toUpperCase();
  const entry = store.get(key);
  if (!entry) {
    return res.status(404).json({ error: "NotFound", message: "Key not found or expired." });
  }

  const secondsRemaining = Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000));
  const stream = createReadStream(entry.path);
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).json({ error: "NotFound", message: "Key not found or expired." });
    else res.destroy();
  });
  stream.once("open", () => {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(entry.size));
    res.setHeader("X-Seconds-Remaining", String(secondsRemaining));
    stream.pipe(res);
  });
});

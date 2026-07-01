import { Router } from "express";
import express from "express";
import { randomBytes } from "crypto";

export const shareRouter = Router();

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** @type {Map<string, { data: Buffer, expiresAt: number }>} */
const store = new Map();

function generateKey() {
  let key = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) key += CHARS[bytes[i] % CHARS.length];
  return key;
}

function purgeExpired() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

shareRouter.post("/upload", express.raw({ limit: "100mb", type: "*/*" }), (req, res) => {
  purgeExpired();

  const data = req.body;
  if (!Buffer.isBuffer(data) || data.length === 0) {
    return res.status(400).json({ error: "EmptyBody", message: "Request body must not be empty." });
  }

  let key;
  let attempts = 0;
  do { key = generateKey(); attempts++; } while (store.has(key) && attempts < 10);

  const expiresAt = Date.now() + TTL_MS;
  store.set(key, { data, expiresAt });

  return res.json({ key, secondsRemaining: Math.floor(TTL_MS / 1000) });
});

shareRouter.get("/:key", (req, res) => {
  purgeExpired();

  const key = req.params.key.toUpperCase();
  const entry = store.get(key);
  if (!entry) {
    return res.status(404).json({ error: "NotFound", message: "Key not found or expired." });
  }

  const secondsRemaining = Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000));
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-Seconds-Remaining", String(secondsRemaining));
  return res.send(entry.data);
});

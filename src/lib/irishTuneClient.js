import axios from "axios";

const BASE_URL = "https://www.irishtune.info";

// Identifiable User-Agent: a scraper that does not hide itself is far less
// likely to get banned than one spoofing a browser UA. It is also the
// least we can do toward a site maintained by a single person.
const USER_AGENT =
  "TuneScraperAPI/0.1 (+contact: your-email@example.com; personal use, low volume)";

// Request pool with configurable concurrency: at most CONCURRENCY requests
// in flight at the same time, each spaced by at least MIN_DELAY_MS from the
// previous launch time. With CONCURRENCY=1, this reproduces the original
// sequential throttling (one request at a time).
//
// CONCURRENCY=1 for now: not enabled until there is a real need for speed
// (e.g. importing a large playlist). Increasing this value to 3–4 is still
// far more respectful than removing throttling entirely — irishtune.info
// is maintained by a single person, and blasting hundreds of requests would
// look like an attack on their server.
const CONCURRENCY = 1;
const MIN_DELAY_MS = 200;

let activeCount = 0;
let lastLaunchAt = 0;
const waiters = [];

function runNext() {
  if (activeCount >= CONCURRENCY || waiters.length === 0) return;

  const elapsed = Date.now() - lastLaunchAt;
  const wait = Math.max(0, MIN_DELAY_MS - elapsed);

  setTimeout(() => {
    if (activeCount >= CONCURRENCY) return; // another slot may have been freed meanwhile

    const next = waiters.shift();
    if (!next) return;

    activeCount += 1;
    lastLaunchAt = Date.now();

    next
      .fn()
      .then(next.resolve, next.reject)
      .finally(() => {
        activeCount -= 1;
        runNext();
      });

    // A slot may still be free: try scheduling the next one too.
    runNext();
  }, wait);
}

function throttle(fn) {
  return new Promise((resolve, reject) => {
    waiters.push({ fn, resolve, reject });
    runNext();
  });
}

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * Fetch raw HTML of a page, with throttling applied.
 * @param {string} path - relative path, e.g. "/tune/1884/"
 * @returns {Promise<string>} HTML
 */
export async function fetchPage(path) {
  return throttle(async () => {
    try {
      const res = await client.get(path);
      return res.data;
    } catch (err) {
      if (err.response) {
        throw new UpstreamError(
          `irishtune.info responded with ${err.response.status} for ${path}`,
          err.response.status
        );
      }
      throw new UpstreamError(
        `Network failure while contacting irishtune.info (${err.message})`,
        502
      );
    }
  });
}

/**
 * Fetch a binary resource (e.g. an mp3 file), with the same throttling as fetchPage.
 * @param {string} path - relative path, e.g. "/album/MC/2_19_2.mp3"
 * @returns {Promise<{ data: Buffer, contentType: string }>}
 */
export async function fetchBinary(path) {
  return throttle(async () => {
    try {
      const res = await client.get(path, { responseType: "arraybuffer" });
      return {
        data: res.data,
        contentType: res.headers["content-type"] ?? "application/octet-stream",
      };
    } catch (err) {
      if (err.response) {
        throw new UpstreamError(
          `irishtune.info responded with ${err.response.status} for ${path}`,
          err.response.status
        );
      }
      throw new UpstreamError(
        `Network failure while contacting irishtune.info (${err.message})`,
        502
      );
    }
  });
}

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}
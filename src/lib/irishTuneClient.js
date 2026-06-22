import axios from "axios";

const BASE_URL = "https://www.irishtune.info";

// Identifiable User-Agent: a scraper that does not hide itself is far less
// likely to get banned than one spoofing a browser UA. It is also the
// least we can do toward a site maintained by a single person.
const USER_AGENT =
  "TuneScraperAPI/0.1 (+contact: your-email@example.com; personal use, low volume)";

// Request pool with configurable concurrency: at most `concurrency` requests
// in flight at the same time, each spaced by at least `minDelayMs` from the
// previous launch time. With concurrency=1, this reproduces simple sequential
// throttling (one request at a time).
//
// Two independent pools are used (see below): pages/search/playlist share one,
// audio files (`/album/*.mp3`) get their own, slower one — irishtune.info's
// rate limiting has been observed to be considerably stricter on `/album/`
// than on regular pages (see "Audio throttling" in the README), so the two
// need different delays rather than a single shared budget.
function createThrottle(concurrency, minDelayMs) {
  let activeCount = 0;
  let lastLaunchAt = 0;
  const waiters = [];

  function runNext() {
    if (activeCount >= concurrency || waiters.length === 0) return;

    const elapsed = Date.now() - lastLaunchAt;
    const wait = Math.max(0, minDelayMs - elapsed);

    setTimeout(() => {
      if (activeCount >= concurrency) return; // another slot may have been freed meanwhile

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

  return function throttle(fn) {
    return new Promise((resolve, reject) => {
      waiters.push({ fn, resolve, reject });
      runNext();
    });
  };
}

// Not enabled until there is a real need for speed (e.g. importing a large
// playlist). Increasing these values is still far more respectful than
// removing throttling entirely — irishtune.info is maintained by a single
// person, and blasting hundreds of requests would look like an attack on
// their server.
const PAGE_CONCURRENCY = 1;
const PAGE_MIN_DELAY_MS = 200;
const pageThrottle = createThrottle(PAGE_CONCURRENCY, PAGE_MIN_DELAY_MS);

// Audio throttling: deliberately much slower than page throttling (see comment
// above createThrottle). 2000ms is a conservative starting point after seeing
// 429s on `/album/*.mp3` at the page-throttle delay (200ms) — tune down only
// if it proves unnecessarily cautious in practice.
const AUDIO_CONCURRENCY = 1;
const AUDIO_MIN_DELAY_MS = 2000;
const audioThrottle = createThrottle(AUDIO_CONCURRENCY, AUDIO_MIN_DELAY_MS);

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
  return pageThrottle(async () => {
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
 * Fetch a binary resource (e.g. an mp3 file), with its own (slower) throttling.
 * @param {string} path - relative path, e.g. "/album/MC/2_19_2.mp3"
 * @returns {Promise<{ data: Buffer, contentType: string }>}
 */
export async function fetchBinary(path) {
  return audioThrottle(async () => {
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
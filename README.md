# tune-scraper-api

A small Node/Express API that fetches and parses pages from [irishtune.info](https://www.irishtune.info), returning clean JSON instead of raw HTML — plus one endpoint that relays an audio file's raw bytes.

## Why

irishtune.info doesn't offer a public API, and its pages (and audio files) don't allow cross-origin requests from a browser. This service sits between your application and the site: it fetches pages and files server-side, parses out the relevant data, and returns structured JSON (or, for `/audio/*`, the raw file) your app can consume directly.

## Endpoints

### `GET /tune/:id`

Fetches a tune's info page and returns its musical details, alternate titles, discography, and related tunes.

```json
{
  "id": 1884,
  "title": "Tell Her I Am",
  "rhythm": "Double jig",
  "bars": 48,
  "structure": "AABBCC",
  "mode": "G Major",
  "titles": ["Tell Her I Am", "Abair Léi go bhFuilim", "..."],
  "featuredAudioUrl": "https://www.irishtune.info/album/MC/2_19_2.mp3",
  "discography": [
    {
      "year": "~1919",
      "track": "24#1",
      "album": "[PT] Patsy Touhey. The Piping of Patsy Touhey. Patsy Touhey (pipes).",
      "audioUrl": "https://www.irishtune.info/album/PT/24_1.mp3"
    }
  ],
  "goesWellWith": { "playedAfter": [...], "playedBefore": [...] },
  "sourceUrl": "https://www.irishtune.info/tune/1884/"
}
```

- `featuredAudioUrl`: the site's chosen reference recording for this tune (the play button near the top of the page), `null` if none.
- `discography[].audioUrl`: direct mp3 link for that specific recording, `null` if none.

### `GET /search?term=...`

Searches tunes by title.

**Query parameters:**
- `term` (required) — search text
- `lookfor` — `words` (default), `string` or `notes`
- `type` — `any` (default), `reel`, `jig`, `slow`, or `other`

```json
{
  "results": [
    {
      "id": 1022,
      "title": "Kesh Jig, The",
      "rhythm": "Double jig",
      "key": "G Major",
      "allTitles": "Kesh Jig, The / Kesh Jig / The Kesh / ..."
    }
  ]
}
```

### `GET /playlist/:username`

Fetches a user's public playlist.

```json
{
  "username": "batpapa",
  "tunes": [{ "id": 1022, "title": "Kesh Jig" }]
}
```

An empty `tunes` array is returned for a playlist with no tunes. If the user doesn't exist or hasn't made any playlist public, the API returns a `404` — irishtune.info itself doesn't distinguish between these two cases, so neither can this API.

### `GET /audio/*`

Fetches an audio file from irishtune.info and relays its raw bytes — the only endpoint that returns binary instead of JSON.

The path is the part of a `featuredAudioUrl` or `discography[].audioUrl` between `/album/` and the `.mp3` extension. For example, given:

```
https://www.irishtune.info/album/MC/2_19_2.mp3
```

request:

```
GET /audio/MC/2_19_2
```

which fetches `https://www.irishtune.info/album/MC/2_19_2.mp3` server-side and relays it with the upstream `Content-Type` (normally `audio/mpeg`).

The path may only contain letters, digits, `_`, `+`, `-`, and `/` between segments — no extension and no `..`. The server always appends `.mp3` and always fetches under `/album/`, so a request can't reach any other path or domain. The upstream response is also checked to actually be an audio file before being relayed; anything else (e.g. an error page at a path that doesn't exist) is rejected.

## Error responses

| Error | Status | Meaning |
|---|---|---|
| `InvalidId` / `InvalidQuery` / `InvalidUsername` / `InvalidPath` | 400 | Bad input |
| `PlaylistNotFound` | 404 | No public playlist for that username |
| `NotAudio` | 404 | The resolved path didn't return an audio file |
| `UpstreamError` | 502 / upstream status | irishtune.info unreachable or returned an error |
| `ParseError` | 502 | Page structure didn't match what the parser expects (the site may have changed) |

## Design notes

- **No caching.** Every request fetches the page fresh. Simple and always up to date; add caching in front of this service if you need it.
- **Polite by default.** Requests to irishtune.info are throttled and sent with an identifying User-Agent. `/tune`, `/search`, and `/playlist` share one throttle pool; `/audio` has its own, independent pool — see "Audio throttling" below for why. Concurrency and delay for the page pool are configurable in `src/lib/irishTuneClient.js`:

  ```js
  const PAGE_CONCURRENCY = 1;     // max simultaneous page requests in flight
  const PAGE_MIN_DELAY_MS = 200;  // minimum delay between page request launches
  ```

  Increase `PAGE_CONCURRENCY` if you need to fetch many tunes faster (e.g. importing a large playlist), but keep in mind irishtune.info is maintained by a single person — avoid hammering it.

### Audio throttling

`/audio/*` is throttled separately and far more conservatively than the rest of the API:

```js
const AUDIO_CONCURRENCY = 1;
const AUDIO_MIN_DELAY_MS = 2000;  // 2s between audio requests
```

This isn't a guess: at the page pool's delay (200ms), repeated `/album/*.mp3` requests started getting `429 Too Many Requests` from irishtune.info well before page requests did — `/*.mp3` is also the one path explicitly called out in their `robots.txt` `Disallow` rules, so it's reasonable to assume audio is more closely watched/rate-limited than the rest of the site. 2000ms is a deliberately conservative starting point to let things cool down; tune it down only if it proves unnecessarily cautious in practice, and watch for 429s if you do.

On the Cadence side, fetching audio is opt-in (off by default) for the same reason — most imports shouldn't touch `/audio/*` at all.

## Running locally

```bash
npm install
npm test
npm run dev
```

```bash
curl http://localhost:3000/tune/1884
curl "http://localhost:3000/search?term=Kesh"
curl http://localhost:3000/playlist/batpapa
curl http://localhost:3000/audio/MC/2_19_2 -o tune.mp3
```

On Windows PowerShell, `curl` is aliased to `Invoke-WebRequest`, which has different syntax. Use `curl.exe` explicitly, or `Invoke-RestMethod` for JSON-friendly output.

## Deploying

This is a standard Node/Express app — it deploys cleanly to any Node-friendly host (Render, Railway, Fly.io, a VPS, etc.). It reads the port from `process.env.PORT`, so no extra configuration is needed beyond a build command (`npm install`) and a start command (`npm start`).

## robots.txt compliance

Checked against irishtune.info's `robots.txt`: none of the paths used by this API (`/tune/`, `/search.php`, `/public/playlist/`, `/album/*.mp3`) are disallowed for the way this API actually uses them. The site's Content Signal directives (`ai-train=no, search=yes, ai-input=yes`) govern AI model training and retrieval use cases, not applicable to a scraping API like this one.

The one relevant `Disallow` rule blocks crawling `*.mp3` files. `robots.txt` rules are aimed at automated crawlers indexing the site in bulk — not at a single file fetched on demand in response to one explicit user action (importing one tune's reference recording), which is what `/audio/*` does. It never enumerates or bulk-downloads audio; each request fetches exactly one file the caller already knows the path to (from a `featuredAudioUrl` or `discography[].audioUrl` returned by `/tune/:id`), and it's throttled the same as every other route.

## Known limitations

- Test fixtures cover one representative case per scenario, not every possible page variation. The parsers aim to fail safe (returning an empty result rather than crashing) when they encounter unexpected structure, but full coverage isn't guaranteed.
- The `lookfor=exact` search parameter is implemented but not extensively tested.

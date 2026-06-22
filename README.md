# tune-scraper-api

A small Node/Express API that fetches and parses pages from [irishtune.info](https://www.irishtune.info), returning clean JSON instead of raw HTML.

## Why

irishtune.info doesn't offer a public API, and its pages don't allow cross-origin requests from a browser. This service sits between your application and the site: it fetches the page server-side, parses out the relevant data, and returns structured JSON your app can consume directly.

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

## Error responses

| Error | Status | Meaning |
|---|---|---|
| `InvalidId` / `InvalidQuery` / `InvalidUsername` | 400 | Bad input |
| `PlaylistNotFound` | 404 | No public playlist for that username |
| `UpstreamError` | 502 / upstream status | irishtune.info unreachable or returned an error |
| `ParseError` | 502 | Page structure didn't match what the parser expects (the site may have changed) |

## Design notes

- **No caching.** Every request fetches the page fresh. Simple and always up to date; add caching in front of this service if you need it.
- **Polite by default.** Requests to irishtune.info are throttled and sent with an identifying User-Agent. Concurrency and delay are configurable in `src/lib/irishTuneClient.js`:

  ```js
  const CONCURRENCY = 1;     // max simultaneous requests in flight
  const MIN_DELAY_MS = 200;  // minimum delay between request launches
  ```

  Increase `CONCURRENCY` if you need to fetch many tunes faster (e.g. importing a large playlist), but keep in mind irishtune.info is maintained by a single person — avoid hammering it.

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
```

On Windows PowerShell, `curl` is aliased to `Invoke-WebRequest`, which has different syntax. Use `curl.exe` explicitly, or `Invoke-RestMethod` for JSON-friendly output.

## Deploying

This is a standard Node/Express app — it deploys cleanly to any Node-friendly host (Render, Railway, Fly.io, a VPS, etc.). It reads the port from `process.env.PORT`, so no extra configuration is needed beyond a build command (`npm install`) and a start command (`npm start`).

## robots.txt compliance

Checked against irishtune.info's `robots.txt`: none of the paths used by this API (`/tune/`, `/search.php`, `/public/playlist/`) are disallowed. The only relevant `Disallow` rule blocks crawling `*.mp3` files directly, which this API doesn't do — it returns mp3 URLs for the client to use, it never fetches the audio itself. The site's Content Signal directives (`ai-train=no, search=yes, ai-input=yes`) govern AI model training and retrieval use cases, not applicable to a scraping API like this one.

## Known limitations

- Test fixtures cover one representative case per scenario, not every possible page variation. The parsers aim to fail safe (returning an empty result rather than crashing) when they encounter unexpected structure, but full coverage isn't guaranteed.
- The `lookfor=exact` search parameter is implemented but not extensively tested.

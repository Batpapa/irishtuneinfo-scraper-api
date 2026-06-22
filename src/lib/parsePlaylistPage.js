import * as cheerio from "cheerio";

/**
 * Error thrown when the user has no public playlist — distinct from an empty
 * playlist, which is a valid result (see fixture playlist-batpapa-empty.html).
 *
 * irishtune.info returns EXACTLY the same generic message for a non-existing
 * user (fixture playlist-not-existing.html) and for an existing user whose
 * playlist is private (fixture playlist-batpapa-private.html) — confirmed by
 * comparing both fixtures character by character, identical except for the
 * username. The site does not distinguish between these two cases (likely to
 * avoid revealing whether an account exists), so we cannot distinguish them
 * here either.
 */
export class PlaylistNotFoundError extends Error {
  constructor(username) {
    super(
      `"${username}" has no public playlist (user does not exist or playlist is private — irishtune.info does not distinguish between the two).`
    );
    this.name = "PlaylistNotFoundError";
    this.username = username;
  }
}

/**
 * Parse a public playlist page (/public/playlist/:username/).
 *
 * Observed structure:
 * - <h1>Current Playlist of\n{username}</h1> → no playlist "name", only username
 * - Non-empty playlist: <table class="datatable"> with <thead>:
 *   Rhythm | Title | Key | First 2 bars | Tune Info
 *   The link to /tune/:id/ is in the LAST column ("Tune Info"), not on the title.
 *   The title itself is plain text in the "Title" column.
 * - Empty playlist (existing user, 0 tunes): NO table at all in the HTML,
 *   but a normal page (site header/footer present), with message
 *   "There are no tunes in this playlist yet." (fixture playlist-batpapa-empty.html).
 *   We rely on absence of a table rather than this exact text: the text may
 *   change wording without affecting structure, whereas "no table" is the
 *   actual signal that matters for parsing.
 * - Non-existing user / non-public playlist: radically different page with
 *   only "Sorry, {username} has not made any playlists public." and no
 *   site header/footer at all (fixture playlist-not-existing.html). This
 *   exact text is used here (and only here) because it is the only available
 *   signal to distinguish this case from a real empty playlist — without it,
 *   both cases would be indistinguishable since neither contains a table.
 *
 * All tunes in a non-empty playlist are rendered at once (no pagination
 * observed), so there is no need to compare an announced count with the
 * extracted count.
 *
 * @param {string} html
 * @param {string} username
 * @throws {PlaylistNotFoundError} if the user has no public playlist
 */
export function parsePlaylistPage(html, username) {
  const $ = cheerio.load(html);

  const notFound = $("*")
    .filter((_, el) =>
      /has not made any playlists public/i.test($(el).text())
    )
    .first().length > 0;

  if (notFound) {
    throw new PlaylistNotFoundError(username);
  }

  // Tunes table: table.datatable with headers Rhythm/Title/Key/.../Tune Info
  let table = $("table.datatable").first();

  if (table.length === 0) {
    // Fallback: table with the highest number of /tune/:id/ links
    let bestTable = null;
    let bestCount = 0;

    $("table").each((_, t) => {
      const linkCount = $(t).find("a[href*='/tune/']").length;
      if (linkCount > bestCount) {
        bestCount = linkCount;
        bestTable = t;
      }
    });

    if (bestTable) table = $(bestTable);
  }

  // No table (and not "not found") = empty playlist, valid result.
  if (table.length === 0) {
    return { username, tunes: [] };
  }

  // Column index mapping from header row (avoid relying on fixed ordering)
  const headerCells = table
    .find("thead tr th, tr")
    .first()
    .find("th, td")
    .map((_, el) => $(el).text().trim())
    .get();

  const titleColIdx = headerCells.findIndex((h) => /^title$/i.test(h));

  const tunes = [];

  table.find("tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    const link = $(row).find("a[href*='/tune/']").first();

    if (!link.length) return;

    const href = link.attr("href") || "";
    const idMatch = href.match(/\/tune\/(\d+)/);

    if (!idMatch) return;

    // Title comes from the "Title" column, not from the link
    // (the link points to "Tune Info", not the tune name).
    const title =
      titleColIdx >= 0 && cells[titleColIdx]
        ? $(cells[titleColIdx]).text().trim()
        : link.text().trim();

    tunes.push({
      id: Number.parseInt(idMatch[1], 10),
      title,
    });
  });

  return {
    username,
    tunes,
  };
}
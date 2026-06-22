import * as cheerio from "cheerio";

/**
 * Error thrown when the HTML does not match the expected structure.
 * Fail-fast error instead of silently returning a half-empty JSON.
 */
export class ParseError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ParseError";
    this.field = field;
  }
}

/**
 * Parses an irishtune.info tune page (e.g. /tune/1884/) into a structured object.
 * @param {string} html
 * @param {number} id
 */
export function parseTunePage(html, id) {
  const $ = cheerio.load(html);

  const title = parseTitle($);
  const { rhythm, bars, structure, mode } = parseInfoTable($);
  const titles = parseTitles($);
  const featuredAudioUrl = parseFeaturedAudio($);
  const discography = parseDiscography($);
  const goesWellWith = parseGoesWellWith($);

  return {
    id,
    title,
    rhythm,
    bars,
    structure,
    mode,
    titles,
    featuredAudioUrl,
    discography,
    goesWellWith,
    sourceUrl: `https://www.irishtune.info/tune/${id}/`,
  };
}

const BASE_URL = "https://www.irishtune.info";

function toAbsoluteUrl(path) {
  if (!path) return null;
  return path.startsWith("http")
    ? path
    : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseTitle($) {
  // The H1 looks like "Tune ID#1884 (Tell Her I Am)"
  const h1 = $("h1").first().text().trim();
  const match = h1.match(/\(([^)]+)\)\s*$/);

  if (!match) {
    throw new ParseError(
      `Unable to extract title from H1: "${h1}"`,
      "title"
    );
  }

  return match[1].trim();
}

function parseFeaturedAudio($) {
  // Play button on the incipit at the top of the page (reference audio excerpt
  // selected for this tune), observed structure:
  //
  //   <div class="incipit-wrap">
  //     <span class="itp-wrap">
  //       <button class="itp-btn" data-src="/album/MC/2_19_2.mp3" ...></button>
  //     </span>
  //     ...
  //   </div>
  //
  // Not a fatal error if absent: some tunes may not have a selected audio excerpt.
  let btn = $(".incipit-wrap .itp-btn[data-src]").first();

  if (btn.length === 0) {
    // Fallback: first itp-btn button on the page that is not located inside
    // a discography row (those also contain .itp-btn buttons, but within <tr> elements).
    btn = $(".itp-btn[data-src]")
      .filter((_, el) => $(el).closest("tr").length === 0)
      .first();
  }

  if (btn.length === 0) return null;

  return toAbsoluteUrl(btn.attr("data-src"));
}

function parseInfoTable($) {
  // "Rhythm | Bars | 8-bar phrase structure | Mode" table
  // Find the header row and the data row immediately following it.
  let headerRow = null;

  $("table").each((_, table) => {
    const firstRowText = $(table).find("tr").first().text();
    if (/Rhythm/i.test(firstRowText) && /Mode/i.test(firstRowText)) {
      headerRow = table;
      return false;
    }
  });

  if (!headerRow) {
    throw new ParseError(
      "Basic information table (Rhythm/Bars/Mode) not found",
      "infoTable"
    );
  }

  const rows = $(headerRow).find("tr");

  const headers = $(rows[0])
    .find("th, td")
    .map((_, el) => $(el).text().trim())
    .get();

  const values = $(rows[1])
    .find("th, td")
    .map((_, el) => $(el).text().trim())
    .get();

  const data = {};
  headers.forEach((h, i) => {
    data[h] = values[i] ?? null;
  });

  const rhythmKey = headers.find((h) => /Rhythm/i.test(h));
  const barsKey = headers.find((h) => /Bars/i.test(h));
  const structureKey = headers.find((h) => /structure/i.test(h));
  const modeKey = headers.find((h) => /Mode/i.test(h));

  return {
    rhythm: rhythmKey ? data[rhythmKey] : null,
    bars: barsKey ? Number.parseInt(data[barsKey], 10) || null : null,
    structure: structureKey ? data[structureKey] : null,
    mode: modeKey ? data[modeKey] : null,
  };
}

function parseTitles($) {
  // Actual observed structure:
  //
  //   <div id="titleexp">... given to this tune in the sources ...</div>
  //   <div class="data notes" id="titles">Title1 / Title2 / ...</div>
  //
  // The content is NOT in the same parent as the marker, so we cannot
  // traverse upward with .closest("p") or .parent() — we must explicitly
  // target the following element.
  let container = $("#titles");

  if (container.length === 0) {
    // Fallback if the id ever changes: take the next sibling of the block
    // containing the marker text.
    const marker = $("*")
      .filter((_, el) =>
        /given to this tune in the sources/i.test($(el).text())
      )
      .first();

    if (marker.length === 0) {
      throw new ParseError(
        "Alternative titles block not found",
        "titles"
      );
    }

    container = marker.nextAll("div").first();
  }

  if (container.length === 0 || !container.text().trim()) {
    throw new ParseError(
      "Alternative titles block not found or empty",
      "titles"
    );
  }

  const text = container.text();

  return text
    .split("/")
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseDiscography($) {
  // Actual observed structure:
  //
  //   <details class="mSection" open>
  //     <summary><h2 id="discog">Discography ...</h2></summary>
  //     <div class="content">
  //       <table class="datatable disctable">...</table>
  //     </div>
  //   </details>
  //
  // The table is not a direct sibling of the <h2> or <summary>:
  // we need to traverse up to the parent <details> and search inside it.
  let table = $("table.disctable").first();

  if (table.length === 0) {
    const heading = $("#discog, h2")
      .filter((_, el) => /^Discography\b/i.test($(el).text().trim()))
      .first();

    if (heading.length === 0) {
      // Not a fatal error: some tunes may not have discography entries.
      return [];
    }

    const section = heading.closest("details, section, div");
    table = section.find("table").first();
  }

  if (table.length === 0) {
    return [];
  }

  const entries = [];

  // Important: use only "tbody tr", NOT "tbody tr, tr"
  // The latter would also match header rows and duplicate entries.
  table.find("tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td, th")
      .map((_, c) => $(c).text().trim())
      .get();

    if (cells.length >= 3 && cells[0]) {
      const audioBtn = $(row).find(".itp-btn[data-src]").first();

      entries.push({
        year: cells[0],
        track: cells[1],
        album: cells[2],
        audioUrl: audioBtn.length
          ? toAbsoluteUrl(audioBtn.attr("data-src"))
          : null,
      });
    }
  });

  return entries;
}

function parseGoesWellWith($) {
  // Two tables: "Played after" / "Played before", each containing links to other tune IDs.
  const result = { playedAfter: [], playedBefore: [] };

  $("table").each((_, table) => {
    const headerText = $(table).find("tr").first().text();

    let key = null;
    if (/Played after/i.test(headerText)) key = "playedAfter";
    else if (/Played before/i.test(headerText)) key = "playedBefore";
    if (!key) return;

    $(table)
      .find("tr")
      .each((i, row) => {
        if (i === 0) return;

        const link = $(row).find("a[href*='/tune/']").first();
        if (!link.length) return;

        const href = link.attr("href") || "";
        const idMatch = href.match(/\/tune\/(\d+)/);

        const albumsCell = $(row).find("td, th").last().text().trim();

        result[key].push({
          id: idMatch ? Number.parseInt(idMatch[1], 10) : null,
          title: link.text().trim(),
          albums: albumsCell,
        });
      });
  });

  return result;
}
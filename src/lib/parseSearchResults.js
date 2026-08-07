import * as cheerio from "cheerio";
import { ParseError } from "./parseTunePage.js";

/**
 * Parse a search results page (search.php?lookfor=words&term=...&type=...)
 * @param {string} html
 * @returns {{results: Array<{id: number, title: string, rhythm: string, key: string, allTitles: string}>}}
 */
export function parseSearchResults(html) {
  const $ = cheerio.load(html);
  
  const results = [];
  
  // Results table: id="results" on the real site, columns:
  // Popularity | Rhythm | Key | Start of Tune | All titles in use.
  let resultsTable = $("table#results").first();
  
  if (resultsTable.length === 0) {
    $("table").each((_, table) => {
      const headerText = $(table).find("tr").first().text();
      if (/Rhythm/i.test(headerText) && /titles in use/i.test(headerText)) {
        resultsTable = $(table);
        return false;
      }
    });
  }

  if (resultsTable.length === 0) {
    // No results table can mean two very different things: a genuine "nothing
    // matched" search (the site still renders its own feedback paragraph in
    // that case — worded differently per search mode, e.g. "No tune titles
    // contain the word '...'." for word search vs "...can not be found in any
    // tune titles." for fragment search, but both mention "tune titles"), or
    // the page structure has changed in a way this parser doesn't recognize.
    // Only the second case should fail loudly — otherwise every legitimate
    // zero-match search would incorrectly report a ParseError.
    const hasNoMatchMessage = $("*").filter((_, el) => {
      const ownText = $(el).clone().children().remove().end().text();
      return /tune titles/i.test(ownText);
    }).length > 0;

    if (!hasNoMatchMessage) {
      throw new ParseError(
        "Results table not found, and no recognizable \"no results\" message either",
        "searchResults"
      );
    }
  }

  if (resultsTable.length > 0)
  {
    resultsTable.find("tbody tr").each((_, row) => {
      const cells = $(row).find("td, th");
      if (cells.length < 5) return;

      // Full rhythm label ("Double jig") is stored in the <abbr> title
      // attribute; the visible text is only the abbreviation ("JigD").
      const rhythmCell = $(cells[1]);
      const rhythmAbbr = rhythmCell.find("abbr[title]").first();

      const rhythm = rhythmAbbr.length
        ? rhythmAbbr.attr("title")
        : rhythmCell.text().trim();

      // Key column: non-breaking spaces between note name and "Major/Minor/etc."
      const key = normalizeSpaces($(cells[2]).text().trim());

      // "Start of Tune" column: link to /tune/:id/
      const tuneLink = $(cells[3]).find("a[href*='/tune/']").first();
      const href = tuneLink.attr("href") || "";
      const idMatch = href.match(/\/tune\/(\d+)/);

      if (!idMatch) return; // skip unusable row instead of failing

      const id = Number.parseInt(idMatch[1], 10);

      // "All titles in use" column:
      // first link = main title, remainder = raw text
      const titlesCell = $(cells[4]);
      const mainTitleLink = titlesCell.find("a[href*='/tune/']").first();

      const title = normalizeSpaces(
        mainTitleLink.text().trim() || titlesCell.text().trim()
      );

      const allTitles = normalizeSpaces(titlesCell.text().trim());

      results.push({ id, title, rhythm, key, allTitles });
    });
  }

  return { results };
}

function normalizeSpaces(str) {
  return str.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}
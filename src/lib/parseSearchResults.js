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
import * as cheerio from "cheerio";
import { ParseError } from "./parseTunePage.js";

/**
 * Parse une page de résultats de recherche (search.php?lookfor=words&term=...&type=...)
 * @param {string} html
 * @returns {{count: number, results: Array<{id: number, title: string, rhythm: string, key: string, allTitles: string}>}}
 */
export function parseSearchResults(html) {
  const $ = cheerio.load(html);

  const countText = $("#resultcount").text() || $("*")
    .filter((_, el) => /distinct tunes? match your search/i.test($(el).text()))
    .first()
    .text();

  const countMatch = countText.match(/(\d+)\s+distinct tunes?/i);
  if (!countMatch) {
    throw new ParseError(
      "Compteur de résultats introuvable — la page ne ressemble pas à une page de résultats de recherche.",
      "count"
    );
  }
  const count = Number.parseInt(countMatch[1], 10);

  const results = [];

  if (count > 0) {
    // Table de résultats : id="results" sur le vrai site, colonnes
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
      throw new ParseError(
        "Table de résultats introuvable alors que le compteur indique des résultats.",
        "resultsTable"
      );
    }

    resultsTable
      .find("tbody tr")
      .each((_, row) => {
        const cells = $(row).find("td, th");
        if (cells.length < 5) return;

        // Le rythme complet ("Double jig") est dans l'attribut title d'un
        // <abbr>, le texte affiché n'est que l'abréviation ("JigD"). On
        // préfère le title quand il existe.
        const rhythmCell = $(cells[1]);
        const rhythmAbbr = rhythmCell.find("abbr[title]").first();
        const rhythm = rhythmAbbr.length
          ? rhythmAbbr.attr("title")
          : rhythmCell.text().trim();

        // Espaces insécables (&nbsp;) entre le nom de note et "Major"/"Minor"/etc.
        const key = normalizeSpaces($(cells[2]).text().trim());

        // Colonne "Start of Tune" : lien vers /tune/:id/
        const tuneLink = $(cells[3]).find("a[href*='/tune/']").first();
        const href = tuneLink.attr("href") || "";
        const idMatch = href.match(/\/tune\/(\d+)/);

        if (!idMatch) return; // ligne non exploitable, on l'ignore plutôt que de planter

        const id = Number.parseInt(idMatch[1], 10);

        // Colonne "All titles in use" : premier lien = titre principal, reste = texte brut
        const titlesCell = $(cells[4]);
        const mainTitleLink = titlesCell.find("a[href*='/tune/']").first();
        const title = normalizeSpaces(
          mainTitleLink.text().trim() || titlesCell.text().trim()
        );
        const allTitles = normalizeSpaces(titlesCell.text().trim());

        results.push({ id, title, rhythm, key, allTitles });
      });
  }

  return { count, results };
}

function normalizeSpaces(str) {
  return str.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

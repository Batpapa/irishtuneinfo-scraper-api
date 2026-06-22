import * as cheerio from "cheerio";

/**
 * Erreur levée quand le HTML ne correspond pas à la structure attendue.
 * Fail-fast nommé plutôt que de renvoyer un JSON à moitié vide en silence.
 */
export class ParseError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ParseError";
    this.field = field;
  }
}

/**
 * Parse une page de tune irishtune.info (ex: /tune/1884/) en objet structuré.
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
  return path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseTitle($) {
  // Le H1 ressemble à "Tune ID#1884 (Tell Her I Am)"
  const h1 = $("h1").first().text().trim();
  const match = h1.match(/\(([^)]+)\)\s*$/);
  if (!match) {
    throw new ParseError(
      `Impossible d'extraire le titre depuis le H1: "${h1}"`,
      "title"
    );
  }
  return match[1].trim();
}

function parseFeaturedAudio($) {
  // Bouton "play" sur l'incipit en haut de page (extrait audio de référence
  // choisi pour cette tune), structure observée :
  //   <div class="incipit-wrap">
  //     <span class="itp-wrap">
  //       <button class="itp-btn" data-src="/album/MC/2_19_2.mp3" ...></button>
  //     </span>
  //     ...
  //   </div>
  // Pas d'erreur fatale si absent : certaines tunes peuvent ne pas avoir
  // d'extrait audio choisi.
  let btn = $(".incipit-wrap .itp-btn[data-src]").first();

  if (btn.length === 0) {
    // Fallback : premier bouton itp-btn de la page situé hors d'une ligne
    // de discographie (celles-ci ont aussi des .itp-btn, mais dans des <tr>).
    btn = $(".itp-btn[data-src]").filter((_, el) => $(el).closest("tr").length === 0).first();
  }

  if (btn.length === 0) return null;

  return toAbsoluteUrl(btn.attr("data-src"));
}

function parseInfoTable($) {
  // Table "Rhythm | Bars | 8-bar phrase structure | Mode"
  // On cherche la ligne d'en-têtes puis la ligne de données juste après.
  let headerRow = null;
  $("table").each((_, table) => {
    const firstRowText = $(table).find("tr").first().text();
    if (/Rhythm/i.test(firstRowText) && /Mode/i.test(firstRowText)) {
      headerRow = table;
      return false; // break
    }
  });

  if (!headerRow) {
    throw new ParseError(
      "Table d'informations de base (Rhythm/Bars/Mode) introuvable",
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
  // Structure réelle observée :
  //   <div id="titleexp">... given to this tune in the sources ...</div>
  //   <div class="data notes" id="titles">Title1 / Title2 / ...</div>
  // Le contenu n'est PAS dans le même parent que le marqueur, donc on ne
  // peut pas remonter avec .closest("p") ou .parent() — il faut cibler
  // l'élément suivant explicitement.
  let container = $("#titles");

  if (container.length === 0) {
    // Fallback si l'id change un jour : prendre le frère suivant du bloc
    // qui contient le texte marqueur.
    const marker = $("*")
      .filter((_, el) => /given to this tune in the sources/i.test($(el).text()))
      .first();

    if (marker.length === 0) {
      throw new ParseError(
        "Bloc des titres alternatifs introuvable",
        "titles"
      );
    }
    container = marker.nextAll("div").first();
  }

  if (container.length === 0 || !container.text().trim()) {
    throw new ParseError(
      "Bloc des titres alternatifs introuvable ou vide",
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
  // Structure réelle observée :
  //   <details class="mSection" open>
  //     <summary><h2 id="discog">Discography ...</h2></summary>
  //     <div class="content">
  //       <table class="datatable disctable">...</table>
  //     </div>
  //   </details>
  // La table n'est pas une sœur directe du <h2> ni du <summary> : il faut
  // remonter au <details> parent puis chercher la table dedans.
  let table = $("table.disctable").first();

  if (table.length === 0) {
    const heading = $("#discog, h2").filter((_, el) =>
      /^Discography\b/i.test($(el).text().trim())
    ).first();

    if (heading.length === 0) {
      // Pas une erreur fatale : certaines tunes peuvent ne pas avoir de discographie indexée.
      return [];
    }

    const section = heading.closest("details, section, div");
    table = section.find("table").first();
  }

  if (table.length === 0) {
    return [];
  }

  const entries = [];
  // Important : "tbody tr" seul, PAS "tbody tr, tr" — ce dernier matche en
  // double les lignes déjà capturées par "tbody tr" en plus de toutes les
  // lignes de <thead>, ce qui comptait le header comme une fausse entrée.
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
        audioUrl: audioBtn.length ? toAbsoluteUrl(audioBtn.attr("data-src")) : null,
      });
    }
  });

  return entries;
}

function parseGoesWellWith($) {
  // Deux tables "Played after" / "Played before", chacune avec liens vers d'autres tune IDs.
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

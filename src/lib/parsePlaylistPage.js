import * as cheerio from "cheerio";

/**
 * Erreur levée quand l'utilisateur n'a pas de playlist publique — distincte
 * d'une playlist vide, qui est un résultat légitime (voir fixture
 * playlist-batpapa-empty.html).
 *
 * irishtune.info renvoie EXACTEMENT le même message générique pour un
 * utilisateur inexistant (fixture playlist-not-existing.html) et pour un
 * utilisateur existant dont la playlist est privée (fixture
 * playlist-batpapa-private.html) — confirmé en comparant les deux fixtures
 * caractère pour caractère, identiques à part le username. Le site ne
 * distingue pas ces deux cas (probablement pour ne pas révéler si un
 * compte existe), donc on ne peut pas non plus les distinguer ici.
 */
export class PlaylistNotFoundError extends Error {
  constructor(username) {
    super(`"${username}" n'a pas de playlist publique (utilisateur inexistant ou playlist privée — irishtune.info ne fait pas la distinction).`);
    this.name = "PlaylistNotFoundError";
    this.username = username;
  }
}

/**
 * Parse une page de playlist publique (/public/playlist/:username/).
 *
 * Structure réelle observée :
 * - <h1>Current Playlist of\n{username}</h1>  → pas de "nom" de playlist, juste le username
 * - Playlist non vide : <table class="datatable"> avec <thead> : Rhythm | Title | Key | First 2 bars | Tune Info
 *   Le lien vers /tune/:id/ est dans la DERNIÈRE colonne ("Tune Info"), pas sur le titre.
 *   Le titre lui-même est du texte brut dans la colonne "Title".
 * - Playlist vide (utilisateur existant, 0 tunes) : PAS de table du tout
 *   dans le HTML, mais une page normale (header/footer du site présents),
 *   message "There are no tunes in this playlist yet." (fixture
 *   playlist-batpapa-empty.html). On se base sur l'absence de table plutôt
 *   que sur ce texte précis : le texte peut changer de formulation sans
 *   rien changer à la structure, alors que "pas de table" est le signal
 *   qui compte vraiment pour le parsing.
 * - Utilisateur inexistant / playlist non publique : page radicalement
 *   différente, juste "Sorry, {username} has not made any playlists
 *   public." sans le moindre header/footer du site (fixture
 *   playlist-not-existing.html). Ce texte précis est utilisé ici (et
 *   seulement ici) car c'est le seul signal disponible pour distinguer ce
 *   cas d'une vraie playlist vide — sans lui, les deux seraient
 *   indiscernables puisqu'aucun des deux n'a de table.
 *
 * Toutes les tunes d'une playlist non vide sont affichées d'un coup dans la
 * table (pas de pagination observée), donc pas besoin de comparer un compte
 * annoncé par la page à un compte réellement extrait.
 *
 * @param {string} html
 * @param {string} username
 * @throws {PlaylistNotFoundError} si l'utilisateur n'a pas de playlist publique
 */
export function parsePlaylistPage(html, username) {
  const $ = cheerio.load(html);

  const notFound = $("*")
    .filter((_, el) => /has not made any playlists public/i.test($(el).text()))
    .first().length > 0;

  if (notFound) {
    throw new PlaylistNotFoundError(username);
  }

  // Table des tunes : table.datatable avec en-têtes Rhythm/Title/Key/.../Tune Info
  let table = $("table.datatable").first();
  if (table.length === 0) {
    // Fallback : table contenant le plus de liens /tune/:id/
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

  // Pas de table (et pas "not found" détecté ci-dessus) = playlist vide,
  // résultat légitime.
  if (table.length === 0) {
    return { username, tunes: [] };
  }

  // Index des colonnes à partir de l'en-tête, pour ne pas dépendre d'un ordre fixe
  const headerCells = table
    .find("thead tr th, tr").first()
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

    // Le titre vient de la colonne "Title" repérée via l'en-tête, pas du lien
    // (le lien pointe vers "Tune Info", pas vers le nom de la tune).
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

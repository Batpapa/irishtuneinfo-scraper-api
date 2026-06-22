import axios from "axios";

const BASE_URL = "https://www.irishtune.info";

// User-Agent identifiable : un site qui scrape sans se cacher se fait
// bien moins vite bannir qu'un user-agent de navigateur usurpé, et c'est
// la moindre des choses vis-à-vis d'un site tenu par une seule personne.
const USER_AGENT =
  "TuneScraperAPI/0.1 (+contact: your-email@example.com; usage personnel, faible volume)";

// Pool de requêtes à concurrence réglable : au plus CONCURRENCY requêtes
// en vol simultanément, chacune espacée d'au moins MIN_DELAY_MS par rapport
// au lancement de la précédente. Avec CONCURRENCY=1 ça reproduit le throttle
// séquentiel d'origine (une requête à la fois).
//
// CONCURRENCY=1 pour l'instant : pas activé tant qu'un vrai besoin de
// vitesse ne se présente pas (ex: import d'une grosse playlist). Passer
// cette valeur à 3-4 reste largement plus respectueux du site qu'un retrait
// pur et simple du throttling — irishtune.info est maintenu par une seule
// personne, et une rafale totale sur des centaines de tunes ressemblerait
// à une attaque depuis leur serveur.
const CONCURRENCY = 1;
const MIN_DELAY_MS = 200;

let activeCount = 0;
let lastLaunchAt = 0;
const waiters = [];

function runNext() {
  if (activeCount >= CONCURRENCY || waiters.length === 0) return;

  const elapsed = Date.now() - lastLaunchAt;
  const wait = Math.max(0, MIN_DELAY_MS - elapsed);

  setTimeout(() => {
    if (activeCount >= CONCURRENCY) return; // une autre slot a pu se libérer entre-temps
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

    // Une slot peut encore être libre : tenter de lancer la suivante aussi.
    runNext();
  }, wait);
}

function throttle(fn) {
  return new Promise((resolve, reject) => {
    waiters.push({ fn, resolve, reject });
    runNext();
  });
}

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * Récupère le HTML brut d'une page du site, throttlé.
 * @param {string} path - chemin relatif, ex: "/tune/1884/"
 * @returns {Promise<string>} HTML
 */
export async function fetchPage(path) {
  return throttle(async () => {
    try {
      const res = await client.get(path);
      return res.data;
    } catch (err) {
      if (err.response) {
        throw new UpstreamError(
          `irishtune.info a répondu ${err.response.status} pour ${path}`,
          err.response.status
        );
      }
      throw new UpstreamError(
        `Échec réseau en contactant irishtune.info (${err.message})`,
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

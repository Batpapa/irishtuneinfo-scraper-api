import { Router } from "express";
import { fetchPage, UpstreamError } from "../lib/irishTuneClient.js";
import { parseSearchResults } from "../lib/parseSearchResults.js";
import { ParseError } from "../lib/parseTunePage.js";

export const searchRouter = Router();

// "words" = chaque mot peut apparaître n'importe où dans un des titres
// "exact"  = fragment exact de titre
const VALID_LOOKFOR = new Set(["words", "exact"]);

// Filtre par type de rythme, valeurs vues sur le site
const VALID_TYPE = new Set(["any", "reel", "jigslide", "song", "notreel"]);

searchRouter.get("/", async (req, res) => {
  const term = (req.query.term || "").toString().trim();
  const lookfor = (req.query.lookfor || "words").toString();
  const type = (req.query.type || "any").toString();

  if (!term) {
    return res.status(400).json({
      error: "InvalidQuery",
      message: "Le paramètre 'term' est requis (le nom ou fragment de tune à chercher).",
    });
  }
  if (!VALID_LOOKFOR.has(lookfor)) {
    return res.status(400).json({
      error: "InvalidQuery",
      message: `'lookfor' doit être l'un de: ${[...VALID_LOOKFOR].join(", ")}`,
    });
  }
  if (!VALID_TYPE.has(type)) {
    return res.status(400).json({
      error: "InvalidQuery",
      message: `'type' doit être l'un de: ${[...VALID_TYPE].join(", ")}`,
    });
  }

  try {
    const params = new URLSearchParams({ lookfor, term, type });
    const html = await fetchPage(`/search.php?${params.toString()}`);
    const data = parseSearchResults(html);

    return res.json(data);
  } catch (err) {
    if (err instanceof ParseError) {
      return res.status(502).json({
        error: "ParseError",
        message: `Le parsing a échoué (champ: ${err.field}). La structure de la page source a peut-être changé.`,
        field: err.field,
      });
    }
    if (err instanceof UpstreamError) {
      return res.status(err.status).json({
        error: "UpstreamError",
        message: err.message,
      });
    }
    return res.status(500).json({
      error: "InternalError",
      message: "Erreur inattendue.",
    });
  }
});

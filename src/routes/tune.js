import { Router } from "express";
import { fetchPage, UpstreamError } from "../lib/irishTuneClient.js";
import { parseTunePage, ParseError } from "../lib/parseTunePage.js";

export const tuneRouter = Router();

tuneRouter.get("/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "InvalidId",
      message: "L'ID de tune doit être un entier positif.",
    });
  }

  try {
    const html = await fetchPage(`/tune/${id}/`);
    const tune = parseTunePage(html, id);

    return res.json(tune);
  } catch (err) {
    if (err instanceof ParseError) {
      // La structure de la page a probablement changé : on le signale
      // explicitement plutôt que de renvoyer un JSON tronqué en silence.
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

import { Router } from "express";
import { fetchPage, UpstreamError } from "../lib/irishTuneClient.js";
import { parseTunePage, ParseError } from "../lib/parseTunePage.js";

export const tuneRouter = Router();

tuneRouter.get("/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "InvalidId",
      message: "Tune ID must be a positive integer.",
    });
  }

  try {
    const html = await fetchPage(`/tune/${id}/`);
    const tune = parseTunePage(html, id);

    return res.json(tune);
  } catch (err) {
    if (err instanceof ParseError) {
      // The page structure has probably changed: report it explicitly
      // rather than silently returning a truncated JSON response.
      return res.status(502).json({
        error: "ParseError",
        message: `Parsing failed (field: ${err.field}). The source page structure may have changed.`,
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
      message: "Unexpected error.",
    });
  }
});
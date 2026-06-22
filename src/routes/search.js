import { Router } from "express";
import { fetchPage, UpstreamError } from "../lib/irishTuneClient.js";
import { parseSearchResults } from "../lib/parseSearchResults.js";
import { ParseError } from "../lib/parseTunePage.js";

export const searchRouter = Router();

// "words"  = each word may appear anywhere in one of the titles
// "string" = exact title fragment
// "notes"  = each word may appear anywhere in my notes
const VALID_LOOKFOR = new Set(["words", "string", "notes"]);

// Tune type filter, values observed on the source site
const VALID_TYPE = new Set(["any", "reel", "jig", "slow", "other"]);

searchRouter.get("/", async (req, res) => {
  const term = (req.query.term || "").toString().trim();
  const lookfor = (req.query.lookfor || "words").toString();
  const type = (req.query.type || "any").toString();

  if (!term) {
    return res.status(400).json({
      error: "InvalidQuery",
      message: "The 'term' parameter is required (the tune name or title fragment to search for).",
    });
  }
  if (!VALID_LOOKFOR.has(lookfor)) {
    return res.status(400).json({
      error: "InvalidQuery",
      message: `'lookfor' must be one of: ${[...VALID_LOOKFOR].join(", ")}`,
    });
  }
  if (!VALID_TYPE.has(type)) {
    return res.status(400).json({
      error: "InvalidQuery",
      message: `'type' must be one of: ${[...VALID_TYPE].join(", ")}`,
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
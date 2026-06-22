import { Router } from "express";
import { fetchPage, UpstreamError } from "../lib/irishTuneClient.js";
import { parsePlaylistPage, PlaylistNotFoundError } from "../lib/parsePlaylistPage.js";
import { ParseError } from "../lib/parseTunePage.js";

export const playlistRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;
playlistRouter.get("/:username", async (req, res) => {
  const { username } = req.params;

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({
      error: "InvalidUsername",
      message: "Username may only contain letters, digits, '_' and '-'.",
    });
  }

  try {
    const html = await fetchPage(`/public/playlist/${username}/`);
    const playlist = parsePlaylistPage(html, username);

    return res.json(playlist);
  } catch (err) {
    if (err instanceof PlaylistNotFoundError) {
      return res.status(404).json({
        error: "PlaylistNotFound",
        message: err.message,
      });
    }
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
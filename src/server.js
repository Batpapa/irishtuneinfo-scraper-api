import express from "express";
import { tuneRouter } from "./routes/tune.js";
import { playlistRouter } from "./routes/playlist.js";
import { searchRouter } from "./routes/search.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/tune", tuneRouter);
app.use("/playlist", playlistRouter);
app.use("/search", searchRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "NotFound", message: "Unknown route." });
});

app.listen(PORT, () => {
  console.log(`tune-scraper-api listening on http://localhost:${PORT}`);
});
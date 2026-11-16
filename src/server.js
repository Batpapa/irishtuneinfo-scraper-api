import express from "express";
import cors from "cors";
import { tuneRouter } from "./routes/tune.js";
import { playlistRouter } from "./routes/playlist.js";
import { searchRouter } from "./routes/search.js";
import { audioRouter } from "./routes/audio.js";
import { shareRouter } from "./routes/share.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Render puts the app behind a proxy — without this, req.ip is the proxy's
// address for every request, not the client's (breaks the /share rate limit).
app.set("trust proxy", true);

app.use(cors());

app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/tune", tuneRouter);
app.use("/playlist", playlistRouter);
app.use("/search", searchRouter);
app.use("/audio", audioRouter);
app.use("/share", shareRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "NotFound", message: "Unknown route." });
});

const server = app.listen(PORT, () => {
  console.log(`tune-scraper-api listening on http://localhost:${PORT}`);
});

// Node ends any request not fully received within 5 minutes by default. A
// large /share upload from a phone can take longer than that; a stalled one is
// ended by the route's own inactivity timeout instead.
server.requestTimeout = 60 * 60 * 1000;
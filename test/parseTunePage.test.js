import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseTunePage, ParseError } from "../src/lib/parseTunePage.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures/tune-1884.html");

test("parseTunePage extrait correctement les champs de base (tune 1884)", async (t) => {
  let html;
  try {
    html = await readFile(FIXTURE, "utf-8");
  } catch {
    t.skip(
      `Fixture manquant: ${FIXTURE}. Lance d'abord:\n` +
        `  curl -s "https://www.irishtune.info/tune/1884/" -o ${FIXTURE}`
    );
    return;
  }

  const tune = parseTunePage(html, 1884);

  assert.equal(tune.id, 1884);
  assert.equal(tune.title, "Tell Her I Am");
  assert.equal(tune.rhythm, "Double jig");
  assert.equal(tune.bars, 48);
  assert.equal(tune.structure, "AABBCC");
  assert.equal(tune.mode, "G Major");
  assert.ok(tune.titles.includes("Tell Her I Am"));
  assert.ok(tune.titles.length > 5, "devrait contenir plusieurs titres alternatifs");

  assert.equal(
    tune.featuredAudioUrl,
    "https://www.irishtune.info/album/MC/2_19_2.mp3"
  );

  // 24 lignes réelles dans le fixture (vérifié avec grep -c sur class="discrow")
  // — ce nombre exact garde le test honnête sur le bug du header compté en trop.
  assert.equal(tune.discography.length, 24);
  assert.equal(
    tune.discography[0].audioUrl,
    "https://www.irishtune.info/album/PT/24_1.mp3"
  );
  assert.ok(
    tune.discography.every((d) => typeof d.audioUrl === "string" && d.audioUrl.startsWith("https://")),
    "chaque entrée de discographie devrait avoir un audioUrl absolu"
  );

  assert.ok(
    tune.goesWellWith.playedAfter.length > 0 ||
      tune.goesWellWith.playedBefore.length > 0,
    "devrait avoir au moins une tune associée"
  );
});

test("parseTunePage lève ParseError sur un HTML qui ne ressemble pas à une page tune", () => {
  const garbage = "<html><body><p>pas une page tune</p></body></html>";
  assert.throws(() => parseTunePage(garbage, 1), ParseError);
});

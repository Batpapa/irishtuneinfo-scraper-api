import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseTunePage, ParseError, splitTitlesBlock } from "../src/lib/parseTunePage.js";

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

const FIXTURE_OTHER = path.join(import.meta.dirname, "fixtures/tune-2294.html");

test("parseTunePage gère une tune de rythme \"Other\" (table réduite, sans Bars/structure/Mode)", async (t) => {
  let html;
  try {
    html = await readFile(FIXTURE_OTHER, "utf-8");
  } catch {
    t.skip(
      `Fixture manquant: ${FIXTURE_OTHER}. Lance d'abord:\n` +
        `  curl -s "https://www.irishtune.info/tune/2294/" -o ${FIXTURE_OTHER}`
    );
    return;
  }

  const tune = parseTunePage(html, 2294);

  assert.equal(tune.id, 2294);
  assert.equal(tune.title, "Itzikel");
  assert.equal(tune.rhythm, "Other");
  assert.equal(tune.bars, null);
  assert.equal(tune.structure, null);
  assert.equal(tune.mode, null);
  // Le commentaire entre crochets est une note, pas un second titre.
  assert.deepEqual(tune.titles, ["Itzikel"]);
  assert.equal(tune.titleNotes.length, 1);
  assert.match(tune.titleNotes[0], /^This tune is not \(yet\?\) part of the Irish tradition/);
});

// ── Bloc des titres ───────────────────────────────────────────────────────────
// Cas relevés sur un échantillon de 70 pages (2026-09-17) ; chacun cassait le
// simple découpage sur "/".

async function fixture(t, id) {
  const file = path.join(import.meta.dirname, `fixtures/tune-${id}.html`);
  try {
    return await readFile(file, "utf-8");
  } catch {
    t.skip(`Fixture manquant: ${file}. Lance d'abord:\n  curl -s "https://www.irishtune.info/tune/${id}/" -o ${file}`);
    return null;
  }
}

test("titres (1884) : les notes collées au dernier titre en sont retirées", async (t) => {
  const html = await fixture(t, 1884);
  if (!html) return;
  const tune = parseTunePage(html, 1884);
  assert.equal(tune.titles[0], "Tell Her I Am");
  assert.equal(tune.titles.at(-1), "Jackson's Dasey");
  assert.equal(tune.titles.length, 10);
  assert.equal(tune.titleNotes.length, 2);
  assert.ok(tune.titleNotes[0].startsWith("2nd in set Tell Her I Am on MC"));
});

test("titres (1461) : un « / » à l'intérieur d'une note ne crée pas de titre", async (t) => {
  const html = await fixture(t, 1461);
  if (!html) return;
  const tune = parseTunePage(html, 1461);
  assert.equal(tune.titles.at(-1), "Stop, Old Hag, or You'll Kill Me");
  assert.ok(!tune.titles.some((ti) => ti.includes("Na Caoirigh")));
  assert.ok(tune.titleNotes.some((n) => n.includes("The Sheep on the Mountains / Na Caoirigh ar na Sléibhte")));
});

test("titres (3164) : une parenthèse au milieu d'un titre en sort sans casser la virgule", async (t) => {
  const html = await fixture(t, 3164);
  if (!html) return;
  const tune = parseTunePage(html, 3164);
  assert.deepEqual(tune.titles, ["Rosses Highland, The", "The Rosses", "Neillidh Ó Baoighill's", "Bonnie Ladd and Bonnie Lass", "Stumpie"]);
  assert.ok(tune.titleNotes.includes("composed by Néilldih Boyle"));
});

test("titres (8759) : une correction d'orthographe entre crochets devient un titre", async (t) => {
  const html = await fixture(t, 8759);
  if (!html) return;
  const tune = parseTunePage(html, 8759);
  assert.deepEqual(tune.titles, ["O' Sullivan's John", "O'Sullivan's John"]);
  assert.deepEqual(tune.titleNotes, ["composed by Pecker Dunne"]);
});

test("splitTitlesBlock : crochet non refermé, blocs vides, espaces", () => {
  assert.deepEqual(splitTitlesBlock("  A  /  B (note"), { titles: ["A", "B"], notes: ["note"] });
  assert.deepEqual(splitTitlesBlock("A [short]"), { titles: ["A", "short"], notes: [] });
  assert.deepEqual(splitTitlesBlock("A [unclosed variant"), { titles: ["A"], notes: ["unclosed variant"] });
  assert.deepEqual(splitTitlesBlock(" / / "), { titles: [], notes: [] });
  assert.deepEqual(splitTitlesBlock("A [A long comment that clearly reads like a whole sentence here]"), {
    titles: ["A"],
    notes: ["A long comment that clearly reads like a whole sentence here"],
  });
});

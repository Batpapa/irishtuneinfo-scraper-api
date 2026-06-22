import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSearchResults } from "../src/lib/parseSearchResults.js";
import { ParseError } from "../src/lib/parseTunePage.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures/search-kesh.html");

test("parseSearchResults extrait résultats (fixture réel, recherche 'Kesh')", async () => {
  const html = await readFile(FIXTURE, "utf-8");
  const { results } = parseSearchResults(html);

  assert.equal(results.length, 11);

  const first = results[0];
  assert.equal(first.id, 1022);
  assert.equal(first.title, "Kesh Jig, The");
  assert.equal(first.rhythm, "Double jig"); // pas l'abréviation "JigD" affichée
  assert.equal(first.key, "G Major"); // espace insécable normalisé
  assert.match(first.allTitles, /Kesh Jig/);
});

test("parseSearchResults lève ParseError sur du HTML qui ne ressemble pas à une page de résultats", () => {
  const garbage = "<html><body><p>rien à voir</p></body></html>";
  assert.throws(() => parseSearchResults(garbage), ParseError);
});

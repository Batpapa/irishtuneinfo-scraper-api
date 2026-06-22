import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parsePlaylistPage, PlaylistNotFoundError } from "../src/lib/parsePlaylistPage.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures/playlist-batpapa.html");
const FIXTURE_EMPTY = path.join(import.meta.dirname, "fixtures/playlist-batpapa-empty.html");
const FIXTURE_NOT_EXISTING = path.join(import.meta.dirname, "fixtures/playlist-not-existing.html");
const FIXTURE_PRIVATE = path.join(import.meta.dirname, "fixtures/playlist-batpapa-private.html");

test("parsePlaylistPage extrait username + tunes (fixture réel, batpapa, 1 tune)", async () => {
  const html = await readFile(FIXTURE, "utf-8");
  const playlist = parsePlaylistPage(html, "batpapa");

  assert.equal(playlist.username, "batpapa");
  assert.equal(playlist.tunes.length, 1);
  assert.equal(playlist.tunes[0].id, 1022);
  assert.equal(playlist.tunes[0].title, "Kesh Jig");
});

test("parsePlaylistPage renvoie un tableau vide (pas une erreur) pour une playlist vide existante (fixture réel)", async () => {
  const html = await readFile(FIXTURE_EMPTY, "utf-8");
  const playlist = parsePlaylistPage(html, "batpapa");

  assert.equal(playlist.username, "batpapa");
  assert.deepEqual(playlist.tunes, []);
});

test("parsePlaylistPage lève PlaylistNotFoundError pour un utilisateur sans playlist publique (fixture réel)", async () => {
  const html = await readFile(FIXTURE_NOT_EXISTING, "utf-8");
  assert.throws(
    () => parsePlaylistPage(html, "notexisting"),
    PlaylistNotFoundError
  );
});

test("parsePlaylistPage lève aussi PlaylistNotFoundError pour une playlist privée d'un utilisateur existant (fixture réel)", async () => {
  // irishtune.info renvoie EXACTEMENT le même message générique ("has not
  // made any playlists public") pour un utilisateur inexistant et pour un
  // utilisateur existant dont la playlist est privée — probablement
  // volontaire de leur part (ne pas révéler si un compte existe). Le site
  // ne distingue pas ces deux cas, donc notre API ne le peut pas non plus :
  // les deux remontent en PlaylistNotFoundError / 404.
  const html = await readFile(FIXTURE_PRIVATE, "utf-8");
  assert.throws(
    () => parsePlaylistPage(html, "batpapa"),
    PlaylistNotFoundError
  );
});

test("parsePlaylistPage renvoie un tableau vide quand aucune table n'est présente et qu'aucun message 'not found' n'est détecté", () => {
  const garbage = "<html><body><p>page sans rapport, aucun texte connu</p></body></html>";
  const playlist = parsePlaylistPage(garbage, "nobody");

  assert.equal(playlist.username, "nobody");
  assert.deepEqual(playlist.tunes, []);
});

# tune-scraper-api

API intermédiaire Node/Express qui scrape irishtune.info et renvoie du JSON propre, pour contourner le blocage CORS côté PWA.

## État actuel

Les trois parsers ont été vérifiés et corrigés contre du **vrai HTML téléchargé** (`tune/1884/`, `search.php?term=Kesh`, `public/playlist/batpapa/`). Les pièges découverts au passage, déjà corrigés dans le code :

- **`/tune/:id`** : le bloc des titres alternatifs (`#titles`) n'est pas dans le même conteneur que le texte qui l'introduit — il a fallu cibler l'id directement. La table de discographie est nichée dans un `<details><summary>...</summary><div class="content"><table>` : la table n'est pas une sœur directe du `<h2>`, il faut remonter au `<details>` parent. Le sélecteur `tbody tr, tr` comptait aussi en double les lignes (chaque ligne matchée deux fois, plus le `<thead>` en plus) — corrigé en `tbody tr` seul, vérifié avec un compte exact (24 lignes) plutôt qu'un simple `> 0`.
- **`/search`** : le rythme affiché dans la table (`JigD`) n'est qu'une abréviation — la valeur complète (`Double jig`) est dans l'attribut `title` d'un `<abbr>`. Les clés musicales (`G Major`) utilisent une espace insécable (`&nbsp;`) entre la note et le mode, normalisée dans `key`/`title`/`allTitles`.
- **`/playlist/:username`** : il n'y a pas de "nom" de playlist nommé par l'utilisateur — juste `"This playlist has N tunes in it."` sous un `<h1>Current Playlist of {username}</h1>` (texte non utilisé par le parser, toutes les tunes étant déjà visibles directement dans la table). Le lien vers `/tune/:id/` est dans une colonne séparée **"Tune Info"** (texte du lien = "Tune Info", pas le titre) ; le vrai titre est dans la colonne **"Title"**, repérée par son en-tête plutôt que par une position fixe.

  Trois cas distincts à connaître pour cette route :
  - **Playlist vide (utilisateur existant)** : page normale (header/footer du site présents), pas de table, message `"There are no tunes in this playlist yet."` (fixture `playlist-batpapa-empty.html`). Traité comme résultat légitime : `{ username, tunes: [] }`.
  - **Utilisateur inexistant OU playlist privée** : page radicalement différente — pas de header/footer du site, juste `"Sorry, {username} has not made any playlists public."`. **irishtune.info renvoie ce message identique dans les deux cas** (confirmé en comparant `playlist-not-existing.html` et `playlist-batpapa-private.html`, identiques au caractère près à part le username) — impossible de les distinguer côté API puisque le site lui-même ne le permet pas. Détecté via ce texte (seul signal disponible, vu qu'aucune table n'existe dans ni l'un ni l'autre cas) et levé comme `PlaylistNotFoundError` → la route renvoie un `404`.
  - **Tout le reste sans table** (HTML générique, structure de page changée de façon imprévue) : traité comme une playlist vide par défaut, `{ username, tunes: [] }`. Délibérément permissif plutôt que fragile sur un texte précis.

Tous les fixtures dans `test/fixtures/` sont désormais de vrais téléchargements, pas des reconstructions à la main.

```bash
npm test
```

doit passer 6/6 tel quel.

## Limites connues

- Les fixtures couvrent un cas par route (1 tune, 1 recherche à 11 résultats, 1 playlist à 1 tune). Une playlist plus grosse, une recherche à 0 résultat, ou une tune sans discographie pourraient révéler d'autres cas limites — le code essaie de rester défensif (`return []` plutôt que planter quand une section est absente), mais ce n'est pas garanti à 100%.
- **robots.txt toujours pas vérifié.** Va sur `https://www.irishtune.info/robots.txt` et regarde s'il y a un `Disallow` sur `/tune/`, `/search.php` ou `/public/playlist/` avant de scraper en volume. Le site dit explicitement "please cite your source", ce qui suggère qu'ils s'attendent à être référencés, mais ça ne dispense pas de vérifier.
- Pas de rate-limit *entrant* (côté ta propre API) — à ajouter si tu l'exposes publiquement.
- Le paramètre `lookfor=exact` (fragment exact de titre) n'a pas été testé — seul `words` a été observé en conditions réelles.

## Ce qui est fait

- `GET /tune/:id` — fetch + parse à chaque appel, pas de cache
- `GET /search?term=...&lookfor=words|exact&type=any|reel|jigslide|song|notreel` — fetch + parse à chaque appel, pas de cache
- `GET /playlist/:username` — fetch + parse à chaque appel, pas de cache
- Throttling réglable (`CONCURRENCY` requêtes en vol max, espacées de `MIN_DELAY_MS`) dans `src/lib/irishTuneClient.js` + User-Agent identifiable vers irishtune.info
- Erreurs distinguées : `InvalidId`/`InvalidQuery`/`InvalidUsername` (400), `PlaylistNotFound` (404, utilisateur sans playlist publique), `ParseError` (502, structure changée), `UpstreamError` (502/upstream status)

## Schéma de réponse `/tune/:id`

```json
{
  "id": 1884,
  "title": "Tell Her I Am",
  "rhythm": "Double jig",
  "bars": 48,
  "structure": "AABBCC",
  "mode": "G Major",
  "titles": ["Tell Her I Am", "Abair Léi go bhFuilim", "..."],
  "featuredAudioUrl": "https://www.irishtune.info/album/MC/2_19_2.mp3",
  "discography": [
    {
      "year": "~1919",
      "track": "24#1",
      "album": "[PT] Patsy Touhey. The Piping of Patsy Touhey. Patsy Touhey (pipes).",
      "audioUrl": "https://www.irishtune.info/album/PT/24_1.mp3"
    }
  ],
  "goesWellWith": { "playedAfter": [...], "playedBefore": [...] },
  "sourceUrl": "https://www.irishtune.info/tune/1884/"
}
```

- `featuredAudioUrl` : extrait audio de référence choisi par le site pour l'incipit (bouton play en haut de page), `null` si absent.
- `discography[].audioUrl` : lien mp3 de cette interprétation précise, construit depuis l'attribut `data-src` du bouton play de chaque ligne, `null` si absent.

## Schéma de réponse `/search?term=Kesh`

```json
{
  "count": 11,
  "results": [
    {
      "id": 1022,
      "title": "Kesh Jig, The",
      "rhythm": "Double jig",
      "key": "G Major",
      "allTitles": "Kesh Jig, The / Kesh Jig / The Kesh / ..."
    }
  ]
}
```

## Pas de cache

Aucune des trois routes ne met rien en cache — chaque appel refait un vrai fetch + parse contre irishtune.info.

## Throttling réglable

`src/lib/irishTuneClient.js` limite les requêtes vers irishtune.info via deux constantes en haut du fichier :

```js
const CONCURRENCY = 1;     // nombre de requêtes en vol simultanément
const MIN_DELAY_MS = 200;  // délai minimum entre deux lancements de requête
```

Actuellement `CONCURRENCY = 1` : une seule requête à la fois, espacée de 200ms (max 5 req/s), comportement identique à un throttle séquentiel classique. C'est volontairement laissé bas tant qu'un vrai besoin de vitesse ne se présente pas.

**Pour accélérer un import de grosse playlist**, monter `CONCURRENCY` à 3 ou 4 fait gagner un facteur proportionnel sur la durée totale, sans tomber dans une rafale totale qui pourrait ressembler à une attaque depuis le serveur d'irishtune.info (maintenu par une seule personne). Le mécanisme (`runNext`/`waiters` dans le même fichier) gère déjà correctement plusieurs requêtes en vol — c'est un simple changement de constante, pas une réécriture.

## Schéma de réponse `/playlist/:username`

```json
{
  "username": "batpapa",
  "tunes": [{ "id": 1022, "title": "Kesh Jig" }]
}
```

## Lancer en local

```bash
npm install
npm test
npm run dev
curl http://localhost:3000/tune/1884
curl "http://localhost:3000/search?term=Kesh"
curl http://localhost:3000/playlist/batpapa
```

Sous PowerShell, `curl` est un alias d'`Invoke-WebRequest` avec une syntaxe différente. Utilise `curl.exe` explicitement, ou `Invoke-WebRequest -Uri "..." -OutFile "..."`.

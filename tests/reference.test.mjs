/**
 * La référence générée (`docs/reference/`) suit le code : API publique, hooks, réglages, contenu, scénarios, et
 * `surface.json` (le contrat des voisins). Une fonction d'API, un hook, un réglage ou un scénario ajouté, renommé ou
 * retiré sans régénérer fait échouer ce test : `npm run reference`, relire le diff (un chemin d'API ou un hook qui
 * disparaît de `surface.json` casse peut-être un module voisin), commiter.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build, undocumented, REFERENCE_DIR } from "../tools/lib/reference.mjs";

// Le premier `build()` charge tout le module : 11 à 13 s dans la passe complète `npm test` sur ce PC (mesuré le
// 2026-11-11, contre 5 à 7 s seul). Même délai et même raison que `load.test.mjs`.
const LOAD_TIMEOUT = 60000;

describe("référence générée", () => {
  it("docs/reference/ est à jour (sinon : npm run reference)", async () => {
    const pages = await build();
    const stale = Object.entries(pages)
      .filter(([name, text]) => !existsSync(join(REFERENCE_DIR, name)) || (readFileSync(join(REFERENCE_DIR, name), "utf8") !== text))
      .map(([name]) => name);
    expect(stale, "pages à régénérer par `npm run reference`").toEqual([]);
  }, LOAD_TIMEOUT);

  it("chaque hook émis est nommé (aucun nom non résolu)", async () => {
    const pages = await build();
    expect(pages["HOOKS.md"]).not.toMatch(/Non résolus/);
  }, LOAD_TIMEOUT);

  // Les pages API.md et HOOKS.md sont ce que lisent les modules voisins et les auteurs de packs : une case vide les renvoie au code.
  // Le groupe `api.mcp` (fonctions de test appelées par le connecteur) est compté comme le reste : il est public lui aussi (un
  // scénario, un voisin qui teste par le connecteur l'appelle), et une ligne de commentaire coûte moins qu'une exception à tenir.
  it("chaque fonction de l'API publique et chaque hook émis ont une description", async () => {
    const { api, hooks } = await undocumented();
    expect(api.map(g => `${g.path} (${g.file || "fichier introuvable"})`),
      "fonctions d'API sans description : écrire un commentaire /** … */ juste avant leur définition (une fonction écrite en ligne dans "
      + "un objet prend une ligne à elle, son commentaire juste au-dessus ; la première phrase doit suffire), puis `npm run reference`").toEqual([]);
    expect(hooks.map(g => `${g.name} (${g.files.join(", ")})`),
      "hooks émis sans description : écrire un commentaire juste avant la constante qui nomme le hook, sinon juste avant la ligne "
      + "`Hooks.call…` (quand il part, sur quel client, ses arguments, l'effet de `false` s'il est annulable), puis `npm run reference`").toEqual([]);
  }, LOAD_TIMEOUT);
});

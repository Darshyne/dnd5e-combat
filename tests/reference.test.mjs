/**
 * La référence générée (`docs/reference/`) suit le code : API publique, hooks, réglages, contenu, scénarios, et
 * `surface.json` (le contrat des voisins). Une fonction d'API, un hook, un réglage ou un scénario ajouté, renommé ou
 * retiré sans régénérer fait échouer ce test : `npm run reference`, relire le diff (un chemin d'API ou un hook qui
 * disparaît de `surface.json` casse peut-être un module voisin), commiter.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build, REFERENCE_DIR } from "../tools/lib/reference.mjs";

describe("référence générée", () => {
  it("docs/reference/ est à jour (sinon : npm run reference)", async () => {
    const pages = await build();
    const stale = Object.entries(pages)
      .filter(([name, text]) => !existsSync(join(REFERENCE_DIR, name)) || (readFileSync(join(REFERENCE_DIR, name), "utf8") !== text))
      .map(([name]) => name);
    expect(stale, "pages à régénérer par `npm run reference`").toEqual([]);
  }, 30000);

  it("chaque hook émis est nommé (aucun nom non résolu)", async () => {
    const pages = await build();
    expect(pages["HOOKS.md"]).not.toMatch(/Non résolus/);
  }, 30000);
});

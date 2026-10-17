/**
 * Le garde-fou des traductions (version anglaise et support multilingue, 2026-10-09) : l'anglais est la langue de repli de
 * Foundry (client/helpers/localization.mjs:236) — une clé absente de `en.json` s'afficherait brute dans toute autre langue.
 *   - fr et en ont exactement les mêmes clés ;
 *   - toute clé écrite en toutes lettres dans le code existe : `"DND5ECOMBAT.…"`, `loc("…")` (runtime/shared.mjs), et les
 *     raccourcis par fichier `const t = (key, data) => game.i18n.format(\`DND5ECOMBAT.<Préfixe>.${key}\`…)` puis `t("…")`.
 * Les clés construites (`loc(\`Recette.${type}.Nom\`)`) ne sont pas lues ici : leurs familles ont leurs propres tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../module");
const lang = l => JSON.parse(readFileSync(join(ROOT, `lang/${l}.json`), "utf8"));
const scripts = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? scripts(join(dir, e.name)) : (e.name.endsWith(".mjs") ? [join(dir, e.name)] : []));

/** `{ clé: [fichiers] }` des clés littérales du code. */
function usedKeys() {
  const used = {};
  const add = (key, file) => (used[key] ??= []).push(relative(ROOT, file));
  for ( const file of scripts(join(ROOT, "scripts")) ) {
    // Commentaires retirés : une clé citée dans un commentaire n'est pas demandée.
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
    for ( const [, k] of src.matchAll(/["'`](DND5ECOMBAT\.[A-Za-z0-9_.]*[A-Za-z0-9_])["'`]/g) ) add(k, file);
    for ( const [, k] of src.matchAll(/\bloc\(\s*["']([A-Za-z0-9_.]+)["']/g) ) add(`DND5ECOMBAT.${k}`, file);
    const prefix = src.match(/const t = \(key, data\) => game\.i18n\.format\(`DND5ECOMBAT\.([A-Za-z0-9_.]+)\.\$\{key\}`/)?.[1];
    if ( prefix ) for ( const [, k] of src.matchAll(/\bt\(\s*["']([A-Za-z0-9_.]+)["']/g) ) add(`DND5ECOMBAT.${prefix}.${k}`, file);
  }
  return used;
}

describe("traductions", () => {
  it("fr a les mêmes clés que en ; pt-BR aucune en trop", () => {
    const en = Object.keys(lang("en")).sort();
    for ( const l of ["fr", "pt-BR"] ) {
      const translation = Object.keys(lang(l)).sort();
      expect(translation.filter(k => !en.includes(k)), `extra keys in ${l}`).toEqual([]);
      // Le portugais peut avoir du retard sur une clé neuve (Foundry montre alors l'anglais) ; le français, jamais.
      if ( l === "fr" ) expect(en.filter(k => !translation.includes(k)), `missing keys in ${l}`).toEqual([]);
    }
  });

  it("aucune valeur vide", () => {
    for ( const l of ["fr", "en", "pt-BR"] ) expect(Object.entries(lang(l)).filter(([, v]) => !String(v).trim()).map(([k]) => k), l).toEqual([]);
  });

  it("les mêmes {variables} dans toutes les langues", () => {
    const en = lang("en");
    const vars = s => Array.from(new Set(Array.from(String(s).matchAll(/\{(\w+)\}/g), m => m[1]))).sort().join(",");
    for ( const l of ["fr", "pt-BR"] ) {
      const translation = lang(l);
      expect(Object.keys(translation).filter(k => (k in en) && (vars(translation[k]) !== vars(en[k]))), l).toEqual([]);
    }
  });

  it("chaque clé écrite dans le code existe en fr et en en", () => {
    const used = usedKeys();
    expect(Object.keys(used).length).toBeGreaterThan(300);
    for ( const l of ["fr", "en"] ) {
      const keys = lang(l);
      const missing = Object.entries(used).filter(([k]) => !(k in keys)).map(([k, files]) => `${k} (${files[0]})`);
      expect(missing, l).toEqual([]);
    }
  });
});

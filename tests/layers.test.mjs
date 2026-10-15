/**
 * Les couches du SPEC §13.3 tiennent par leurs imports, pas par convention :
 *   core/     n'importe que core/
 *   content/  n'importe que content/ et core/
 *   adapter/  n'importe jamais runtime/ ni ui/
 *   runtime/  n'importe jamais ui/ — l'interface lit l'état et émet des intentions, rien ne remonte
 *   ui/       importe ce qu'il veut
 * Et core/ ne touche à aucun global de Foundry.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../module/scripts");
const LAYERS = ["core", "content", "adapter", "runtime", "ui"];

/** Les fichiers d'une couche, sous-dossiers compris (`runtime/diagnostic/…`). */
const files = dir => readdirSync(join(ROOT, dir)).flatMap(f => statSync(join(ROOT, dir, f)).isDirectory() ? files(`${dir}/${f}`)
  : (f.endsWith(".mjs") ? [`${dir}/${f}`] : []));
const source = file => readFileSync(join(ROOT, file), "utf8");

/** Le chemin (depuis module/scripts) d'un import relatif d'un fichier. */
function resolve(file, spec) {
  const parts = file.split("/").slice(0, -1);
  for ( const seg of spec.split("/") ) {
    if ( seg === "." ) continue;
    if ( seg === ".." ) parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** Les couches qu'un fichier importe : le premier dossier du chemin résolu (`../../runtime/x.mjs` d'un sous-dossier compris). */
function importedLayers(file) {
  const out = new Set();
  for ( const [, spec] of source(file).matchAll(/from\s+"([^"]+)"/g) ) {
    if ( !spec.startsWith(".") ) continue;
    const layer = resolve(file, spec).split("/")[0];
    if ( LAYERS.includes(layer) ) out.add(layer);
  }
  return out;
}

const forbidden = {
  core: ["content", "adapter", "runtime", "ui"],
  content: ["adapter", "runtime", "ui"],
  adapter: ["runtime", "ui"],
  runtime: ["ui"],
  ui: []
};

describe("couches", () => {
  for ( const layer of LAYERS ) {
    it(`${layer}/ n'importe pas ${forbidden[layer].join(", ") || "(sans contrainte)"}`, () => {
      for ( const file of files(layer) ) {
        const bad = [...importedLayers(file)].filter(l => forbidden[layer].includes(l));
        expect(bad, file).toEqual([]);
      }
    });
  }

  it("core/ ne référence aucun global de Foundry", () => {
    for ( const file of files("core") ) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\b(game|canvas|Hooks|CONFIG|ui)\s*[.[]/);
    }
  });
});

/**
 * §15.1 — un seul chemin pour toute action : l'interface ne lance jamais une activité elle-même
 * (ni `use`, ni jet, ni consommation) ; elle passe par runtime/, qui finit dans `activity.use()`,
 * donc dans `dnd5e.preUseActivity` (visée, légalité) comme la fiche et la barre BG3.
 */
describe("un seul chemin pour toute action", () => {
  it("ui/ n'appelle ni use, ni rollAttack, ni rollDamage, ni consume", () => {
    for ( const file of files("ui") ) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // commentaires exclus
      expect(code, file).not.toMatch(/\.(use|rollAttack|rollDamage|consume)\(/);
    }
  });

  it("engage (clic, menu, visée) finit dans activity.use()", () => {
    const code = source("runtime/actions.mjs");
    const body = code.slice(code.indexOf("export async function engage"), code.indexOf("/*", code.indexOf("export async function engage")));
    expect(body).toMatch(/await activity\.use\(/);
  });
});

/**
 * Sous Vitest (transformation de Vite), un import d'un nom qui n'existe pas donne `undefined` au lieu
 * d'échouer au chargement : tests/load.test.mjs ne voit pas un export cassé. On le vérifie ici, à la lecture :
 * tout nom importé d'un fichier du module doit en être exporté (vu le 2026-09-23 : `escapeGrapple` importé
 * par ui/pointer.mjs avant d'exister, tests verts).
 */
describe("imports et exports du module", () => {
  const exportsOf = (file, seen=new Set()) => {
    const code = source(file);
    const names = new Set();
    if ( seen.has(file) ) return names;
    seen.add(file);
    // `export * from "./x.mjs"` : tout ce que l'autre fichier exporte (un fichier-façade après découpage).
    for ( const [, spec] of code.matchAll(/export\s*\*\s*from\s*"(\.[^"]+)"/g) ) {
      for ( const name of exportsOf(resolve(file, spec), seen) ) names.add(name);
    }
    for ( const [, name] of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g) ) names.add(name);
    for ( const [, list] of code.matchAll(/export\s*\{([^}]*)\}/g) ) {
      for ( const part of list.split(",") ) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if ( name ) names.add(name);
      }
    }
    return names;
  };
  const allFiles = LAYERS.flatMap(files);

  it("chaque nom importé existe dans le fichier d'où on l'importe", () => {
    const missing = [];
    for ( const file of allFiles ) {
      for ( const [, list, spec] of source(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g) ) {
        const target = resolve(file, spec);
        if ( !allFiles.includes(target) ) continue;
        const available = exportsOf(target);
        for ( const part of list.split(",") ) {
          const name = part.trim().split(/\s+as\s+/)[0]?.trim();
          if ( name && !available.has(name) ) missing.push(`${file} → ${name} (de ${target})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

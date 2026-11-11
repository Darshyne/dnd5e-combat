#!/usr/bin/env node
/**
 * Régénère la référence du moteur dans `docs/reference/` : API publique, hooks, réglages, contenu, scénarios, et
 * `surface.json` (le contrat pour les voisins). Tout est relu dans le code (`tools/lib/reference.mjs`).
 *   npm run reference            écrit les pages
 *   node tools/reference.mjs --check   dit ce qui n'est plus à jour, sans rien écrire
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, REFERENCE_DIR } from "./lib/reference.mjs";

const check = process.argv.includes("--check");
const pages = await build();
let stale = 0;
if ( !check ) mkdirSync(REFERENCE_DIR, { recursive: true });
for ( const [name, text] of Object.entries(pages) ) {
  const file = join(REFERENCE_DIR, name);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  if ( current === text ) continue;
  stale += 1;
  if ( check ) console.error(`reference | ${name} n'est plus à jour`);
  else { writeFileSync(file, text); console.log(`reference | ${name} écrit`); }
}
if ( !stale ) console.log("reference | tout est à jour");
if ( check && stale ) { console.error("reference | npm run reference"); process.exitCode = 1; }

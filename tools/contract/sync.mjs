#!/usr/bin/env node
/**
 * Recopie les tests modèles de la suite DAS (ce dossier) dans `tests/` des modules : la copie est identique au modèle, ce
 * qui est propre à un module reste dans ses fichiers de réglage (`tests/das-tests.json`, `tests/core-contract.json`), que
 * cet outil ne touche jamais.
 *
 *   node tools/contract/sync.mjs           recopie les modèles dans les modules présents à côté de ce dépôt
 *   node tools/contract/sync.mjs --check   ne recopie rien : dit quelles copies diffèrent du modèle (code de sortie 1 si une diffère)
 *
 * Où : les dépôts voisins du moteur (`../<dossier>`), d'après la liste MODULES ; un dépôt absent est signalé et passé.
 * `core-contract.test.mjs` va chez les voisins seulement (le moteur ne se teste pas contre lui-même) ; les modèles `das-*`
 * vont aussi dans `tests/` du moteur. Après une recopie : `npm test` dans chaque module, puis un commit par dépôt.
 * Sans dépendance (Node seul).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..");
const PARENT = join(CORE, "..");

/** Les modèles, et à qui ils vont. */
const TEMPLATES = [
  { file: "core-contract.test.mjs", core: false },
  { file: "das-i18n.test.mjs", core: true },
  { file: "das-layers.test.mjs", core: true },
  { file: "das-syntax.test.mjs", core: true }
];

/** Les modules voisins, par nom de dossier (à côté du dépôt du moteur). */
const MODULES = [
  "Foundry dnd5e interface de combat",
  "Foundry dnd5e butin et commerce",
  "Foundry dnd5 Vision et lumière",
  "Foundry dnd5e animations",
  "Foundry dnd5e homebrew",
  "Foundry dnd5e PNJ automatisés",
  "Foundry dnd5e manette"
];

const check = process.argv.includes("--check");
// Fins de ligne : une copie extraite en CRLF sur Windows n'est pas « différente ».
const read = file => existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;

const targets = [{ name: "(moteur)", dir: CORE, core: true }, ...MODULES.map(name => ({ name, dir: join(PARENT, name), core: false }))];
let differ = 0;
let missing = 0;
for ( const target of targets ) {
  if ( !existsSync(join(target.dir, "tests")) ) {
    console.log(`?  ${target.name} : dossier absent (${target.dir}), passé`);
    missing++;
    continue;
  }
  for ( const template of TEMPLATES.filter(t => !target.core || t.core) ) {
    const model = read(join(HERE, template.file));
    const copyPath = join(target.dir, "tests", template.file);
    const copy = read(copyPath);
    if ( copy === model ) { console.log(`=  ${target.name} : ${template.file}`); continue; }
    differ++;
    if ( check ) { console.log(`≠  ${target.name} : ${template.file} ${copy === null ? "absent" : "diffère du modèle"}`); continue; }
    writeFileSync(copyPath, model);
    console.log(`→  ${target.name} : ${template.file} ${copy === null ? "créé" : "mis à jour"}`);
  }
}
if ( check ) {
  console.log(differ ? `\n${differ} copie(s) à recopier : node tools/contract/sync.mjs` : "\nToutes les copies sont identiques aux modèles.");
  if ( missing ) console.log(`${missing} dépôt(s) absent(s) de ce poste, non vérifié(s).`);
  process.exitCode = differ ? 1 : 0;
}
else console.log(differ ? `\n${differ} copie(s) écrite(s) : lancer npm test dans chaque module, puis commiter.` : "\nRien à recopier.");

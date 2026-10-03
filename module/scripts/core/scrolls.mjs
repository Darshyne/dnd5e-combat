/**
 * §48 : le sort qu'un parchemin contient. Fonctions pures.
 *
 * dnd5e 6 fabrique un parchemin comme un consommable (`system.type.value === "scroll"`) qui recopie les activités, les effets
 * et les propriétés du sort, mais garde l'identifiant du parchemin de base (`spell-scroll`, `spell-scroll-2nd-level`) et ne
 * dit nulle part de quel sort il s'agit (documents/item.mjs:1346, `createScrollFromSpell`) ; le niveau seul est noté, dans
 * `flags.dnd5e.spellLevel`. Les parchemins du monde viennent de trois chemins, relevés dans `ravenloft-test` le 2026-10-02 :
 *  - dnd5e (fiche, marchand) : « Parchemin: Mot de guérison », nom anglais du sort dans `flags.babele.originalName` ;
 *  - import D&D Beyond : « Parchemin: Command », nom anglais du sort dans `flags.ddbimporter.originalName` ;
 *  - anciens : « Spell Scroll: Spiritual Weapon », sans autre indice que le nom.
 * D'où : l'identifiant que le moteur pose lui-même à la création (`stamped`), sinon des candidats tirés de ces noms, validés
 * contre l'index des sorts connus (noms français et anglais, identifiants).
 */

/**
 * Un texte en identifiant comme dnd5e le forme (utils.mjs, `formatIdentifier` : « a/b » → « a-b », puis le
 * `slugify({ strict: true })` du cœur, common/primitives/string.mjs:73 : accents translittérés, espaces et tirets en un
 * tiret, tout autre caractère RETIRÉ — « Melf's » → « melfs »).
 */
export function slug(text) {
  return String(text ?? "").replaceAll(/(\w+)([\\|/])(\w+)/g, "$1-$3")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()
    .replace(/[\s-]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/** Les noms du parchemin de base, pas d'un sort (« Spell Scroll, 1st Level », « Parchemin de sort : 1er niveau »). */
const BASE = /^(spell-scroll|parchemin)(-|$)|^(\d+(st|nd|rd|th|er|e)-level|\d+(er|e)-niveau|cantrip|sorts?-mineurs?)$/;

/** Le nom du sort dans un nom de parchemin : ce qui suit les deux-points, ou le nom entier s'il n'y en a pas. */
export function spellPartOf(name) {
  const text = String(name ?? "");
  const at = text.lastIndexOf(":");
  return (at >= 0 ? text.slice(at + 1) : text).trim();
}

/**
 * Les identifiants candidats d'un parchemin, du plus sûr au moins sûr : les noms d'origine (anglais) avant le nom affiché.
 * @param {object} names
 * @param {string} [names.name]                 Le nom de l'item.
 * @param {string[]} [names.originalNames=[]]   Babele, import D&D Beyond.
 * @returns {string[]}
 */
export function scrollCandidates({ name, originalNames=[] }={}) {
  const out = [];
  for ( const text of [...originalNames, name] ) {
    const candidate = slug(spellPartOf(text));
    if ( candidate && !BASE.test(candidate) && !out.includes(candidate) ) out.push(candidate);
  }
  return out;
}

/**
 * Le sort d'un parchemin, ou null.
 * @param {object} args
 * @param {{identifier: string, level?: number, school?: string}|null} [args.stamped]  Posé par le moteur à la création.
 * @param {string[]} args.candidates                     scrollCandidates.
 * @param {Map<string, {identifier: string, level?: number, school?: string}>} args.known
 *   L'index des sorts : identifiant, nom français et nom anglais (en `slug`) → le sort.
 * @param {number|null} [args.level]                     `flags.dnd5e.spellLevel.value` du parchemin.
 * @returns {{identifier: string, level: number|null, school: string|null}|null}
 */
export function scrollSpell({ stamped=null, candidates=[], known=new Map(), level=null }) {
  const found = stamped?.identifier ? stamped : candidates.map(c => known.get(c)).find(Boolean);
  if ( !found?.identifier ) return null;
  const lvl = Number.isFinite(level) ? level : (Number.isFinite(found.level) ? found.level : null);
  return { identifier: found.identifier, level: lvl, school: found.school ?? null };
}

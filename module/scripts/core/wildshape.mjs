/**
 * Forme sauvage (SPEC §16.39), la partie qui se calcule sans Foundry. Règles du PHB 2024 (druide) :
 *  - formes connues : 4 au niveau 2, 6 au niveau 4, 8 au niveau 8 (colonne « Formes connues ») ;
 *  - une forme se prend dans ses formes connues, dans les limites du profil de l'activité — FP maximal, type (Bête), et
 *    pas de vitesse de vol avant le niveau 8 (dnd5e : `profiles[].cr`, `types`, `movement` exclu).
 * Fonctions pures.
 */

/** Le nombre de formes connues d'un druide de ce niveau. */
export function knownFormsMax(druidLevel) {
  if ( druidLevel >= 8 ) return 8;
  if ( druidLevel >= 4 ) return 6;
  if ( druidLevel >= 2 ) return 4;
  return 0;
}

/**
 * Pourquoi cette forme n'est pas permise par ce profil, ou null.
 * @param {{cr: number|null, type: string|null, fly: number}} form        La créature (FP, type, vitesse de vol).
 * @param {{maxCr: number|null, types: string[], noMovement: string[]}} limits  Le profil de l'activité.
 * @returns {"cr"|"type"|"fly"|null}
 */
export function formRefusal(form, { maxCr=null, types=[], noMovement=[] }={}) {
  if ( Number.isFinite(maxCr) && Number.isFinite(form.cr) && (form.cr > maxCr) ) return "cr";
  if ( types.length && !types.includes(form.type) ) return "type";
  if ( noMovement.includes("fly") && (form.fly > 0) ) return "fly";
  return null;
}

/** La forme doit-elle prendre fin ? « Elle cesse si vous êtes Neutralisé ou si vous mourez » (et à 0 PV, on tombe). */
export function formMustEnd({ hp, statuses=[] }, incapacitating=[]) {
  if ( Number.isFinite(hp) && (hp <= 0) ) return true;
  return statuses.some(s => incapacitating.includes(s));
}

/* -------------------------------------------- */
/*  Cercle de la Lune : deux identifiants (§432) */
/* -------------------------------------------- */

/** Les deux identifiants de la sous-classe : `moon` (Manuel des joueurs 2.2.0), `circle-moon` (préréglage de dnd5e 6.1). */
const MOON_IDS = Object.freeze(["circle-moon", "moon"]);
const MOON_LEVELS = /@subclasses\.(circle-moon|moon)\.levels/g;
const BOTH_LEVELS = `max(${MOON_IDS.map(id => `@subclasses.${id}.levels`).join(", ")})`;

/**
 * §432 : une formule du préréglage de Forme sauvage (CA minimale, PV temporaires) qui lit le niveau du Cercle de la Lune sous un
 * seul des deux identifiants — rendue lisant le plus grand des deux. dnd5e 6.0 écrit `@subclasses.moon.levels`, dnd5e 6.1
 * `@subclasses.circle-moon.levels`, et la sous-classe du Manuel des joueurs s'appelle toujours `moon` : en 6.1, le druide de la Lune
 * perdait sa CA minimale et ses PV temporaires. Une formule qui nomme déjà les deux, ou aucun, revient telle quelle.
 */
export function moonLevelsFormula(formula) {
  if ( typeof formula !== "string" ) return formula;
  const named = new Set(Array.from(formula.matchAll(MOON_LEVELS), m => m[1]));
  if ( named.size !== 1 ) return formula;
  return formula.replace(MOON_LEVELS, BOTH_LEVELS);
}

/** §432 : les listes de sorts gardées sous la forme (`subclass:circle-moon`) — avec celle de l'autre identifiant, si l'une y est. */
export function moonSpellLists(lists) {
  const all = Array.from(lists ?? []);
  const keys = MOON_IDS.map(id => `subclass:${id}`);
  if ( !keys.some(k => all.includes(k)) ) return all;
  return Array.from(new Set([...all, ...keys]));
}

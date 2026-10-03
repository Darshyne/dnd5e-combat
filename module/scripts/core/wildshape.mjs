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

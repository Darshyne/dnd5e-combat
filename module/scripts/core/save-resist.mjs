/**
 * Un objet qui change une sauvegarde ratée en réussite (clé de contenu `saveResist`) : Bâton d'envoûtement — « si vous ratez un jet de
 * sauvegarde contre un sort d'enchantement qui ne cible que vous, vous pouvez changer cet échec en réussite ; vous ne pouvez plus
 * utiliser cette propriété avant l'aube ». Les utilisations sont celles de l'activité de l'objet. Fonctions pures.
 */

/**
 * La règle vaut-elle contre ce qui impose la sauvegarde ?
 * @param {{activity: string, schools?: string[], singleTarget?: boolean}|null|undefined} rule
 * @param {{isSpell: boolean, school: string|null, targets: number}} against
 */
export function saveResistApplies(rule, { isSpell, school, targets }) {
  if ( !rule?.activity || !isSpell ) return false;
  if ( rule.schools && !rule.schools.includes(school) ) return false;
  return !rule.singleTarget || (targets === 1);
}

/** Les erreurs de la clé. Vide = valide. */
export function validateSaveResist(rule, at, isId) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && isId(rule.activity)
    && (!("schools" in rule) || (Array.isArray(rule.schools) && rule.schools.length && rule.schools.every(s => typeof s === "string")))
    && (!("singleTarget" in rule) || (rule.singleTarget === true))
    && Object.keys(rule).every(k => ["activity", "schools", "singleTarget"].includes(k));
  return ok ? [] : [`${at}saveResist: { activity: activity id, schools?: [spell schools], singleTarget?: true }`];
}

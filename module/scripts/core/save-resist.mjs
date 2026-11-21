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

/**
 * `saveReflect` : la même forme, pour une sauvegarde RÉUSSIE — « si vous réussissez un jet de sauvegarde contre un sort
 * d'enchantement qui ne cible que vous, vous pouvez utiliser votre Réaction pour dépenser 1 charge et retourner le sort contre son
 * lanceur, comme si vous l'aviez lancé ». Vaut-elle, avec une charge et une Réaction ?
 */
export function saveReflectApplies(rule, against, { charges, reaction }) {
  return saveResistApplies(rule, against) && (charges >= 1) && (reaction !== false);
}

/** Les erreurs de la clé. Vide = valide. */
export function validateSaveResist(rule, at, isId, key="saveResist") {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && isId(rule.activity)
    && (!("schools" in rule) || (Array.isArray(rule.schools) && rule.schools.length && rule.schools.every(s => typeof s === "string")))
    && (!("singleTarget" in rule) || (rule.singleTarget === true))
    && Object.keys(rule).every(k => ["activity", "schools", "singleTarget"].includes(k));
  return ok ? [] : [`${at}${key}: { activity: activity id, schools?: [spell schools], singleTarget?: true }`];
}

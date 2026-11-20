/**
 * Un coup dont les dégâts cèdent la place à une autre activité de l'item, au choix de l'auteur (clé de contenu `hitInstead`) : Arc
 * d'énergie, Flèche d'entrave — « vous pouvez tenter d'entraver la cible au lieu de lui infliger des dégâts ; si la flèche touche,
 * la cible doit réussir un jet de sauvegarde de Force DD 15 ou avoir l'état Entravé pendant 1 minute ». Fonctions pures.
 */

/** La règle vaut-elle pour ce coup ? Une attaque de l'item, dont l'activité sœur existe. */
export function hitInsteadApplies(rule, { isAttack, hasSibling }) {
  return !!rule?.activity && isAttack === true && hasSibling === true;
}

/** L'unique élément d'une liste, ou null s'il n'y en a pas exactement un. */
export function soleOf(list) {
  return ((list ?? []).length === 1) ? list[0] : null;
}

/** Les erreurs de la clé. Vide = valide. */
export function validateHitInstead(rule, at, isId) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && ((rule.activity === "sole") || isId(rule.activity))
    && Object.keys(rule).every(k => k === "activity");
  return ok ? [] : [`${at}hitInstead: { activity: activity id | "sole" }`];
}

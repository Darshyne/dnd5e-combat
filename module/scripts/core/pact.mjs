/**
 * Arme de pacte (SPEC §16.45, clé `pact` de core/content.mjs) : l'enchantement « Pact Weapon » du PHB 2.2.0 rend l'arme
 * maîtrisée et focaliseur, et **ajoute** les types nécrotique, psychique et radiant à ses dégâts (on choisirait à chaque jet) ;
 * il n'applique pas le Charisme. PHB 2024 : l'occultiste peut attaquer et frapper avec son Charisme plutôt qu'avec la Force ou
 * la Dextérité, et choisir entre les dégâts nécrotiques, psychiques, radiants ou le type propre à l'arme. Le type se choisit **à chaque attaque** (demande de l'utilisateur,
 * 2026-09-26 : adapter/messages.mjs, `damageTypeChoices`) : les types ajoutés restent, sauf si un type est imposé. Fonctions pures.
 */

const TYPE_KEYS = Object.freeze(["system.damage.base.types", "system.damage.versatile.types"]);

/**
 * Les changements de l'enchantement, réécrits selon le choix.
 * @param {Array<{key: string, type: string, value: *}>} changes  Ceux du profil de dnd5e.
 * @param {{damageTypes: string[], chosen: string|null, ability?: string|null, suffix?: string|null}} options
 *        `chosen` : un des `damageTypes` imposé, ou null (tous restent : le choix se fait à chaque attaque) ; `ability` : la caractéristique des attaques de
 *        l'arme (« spellcasting ») ; `suffix` : ce qui s'ajoute au nom de l'arme.
 */
export function rewritePactChanges(changes, { damageTypes, chosen=null, ability=null, suffix=null }) {
  const imposed = chosen && damageTypes.includes(chosen);
  const out = (changes ?? []).filter(c => !(imposed && TYPE_KEYS.includes(c.key) && damageTypes.includes(String(c.value))))
    .map(c => ((c.key === "name") && suffix) ? { ...c, value: suffix } : c);
  if ( imposed ) for ( const key of TYPE_KEYS ) out.push({ key, type: "override", value: chosen, phase: "initial" });
  if ( ability ) out.push({ key: "activities[attack].attack.ability", type: "override", value: ability, phase: "initial" });
  return out;
}

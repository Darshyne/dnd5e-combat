/**
 * O9h (§363) : les enduits d'arme (Poison standard : « une arme ou jusqu'à trois munitions »). Pur : aucune dépendance à Foundry.
 */

/**
 * Les items qui peuvent recevoir l'enduit : armes (hors armes naturelles) dont un type de dégâts le délivre, et munitions.
 * @param {Array<{id, name, type, kind, damageTypes: string[], equipped: boolean, quantity: number}>} items
 * @param {{ damageTypes: string[], ammunition?: number }} rule
 * @returns {Array<{id, name, ammunition: boolean}>}  Armes équipées d'abord.
 */
export function coatingCandidates(items, rule) {
  const delivers = i => (i.damageTypes ?? []).some(t => rule.damageTypes.includes(t));
  const weapons = items.filter(i => (i.type === "weapon") && (i.kind !== "natural") && delivers(i))
    .sort((a, b) => Number(b.equipped) - Number(a.equipped));
  const ammo = rule.ammunition ? items.filter(i => (i.type === "consumable") && (i.kind === "ammo") && ((i.quantity ?? 0) > 0)) : [];
  return [...weapons.map(i => ({ id: i.id, name: i.name, ammunition: false })), ...ammo.map(i => ({ id: i.id, name: i.name, ammunition: true }))];
}

/**
 * L'enduit vaut-il pour ce jet de dégâts ? « dry » (sec ou épuisé : à retirer), « applies », ou « no » (le jet n'a pas le bon type).
 * @param {{ until: number, deliveredBy: string[], charges?: number }} coating
 * @param {{ now: number, types: string[] }} roll
 */
export function coatingApplies(coating, { now, types }) {
  if ( !coating || !(Number(coating.charges ?? 1) > 0) || !(now <= coating.until) ) return "dry";
  return (types ?? []).some(t => (coating.deliveredBy ?? []).includes(t)) ? "applies" : "no";
}

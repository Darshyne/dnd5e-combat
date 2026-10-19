/**
 * §214 : Formation au port d'armure (règles 2024, glossaire « Armor Training »). Sans formation pour l'armure portée : Désavantage aux
 * tests d20 qui font appel à la Force ou à la Dextérité, et pas de sorts ; sans formation pour le bouclier : pas de bonus de CA.
 *
 * dnd5e 6 calcule la formation (`EquipmentData#proficiencyMultiplier`, data/item/equipment.mjs:180 — un PNJ est toujours formé aux
 * armures de son profil) mais n'en tire rien : ni Désavantage, ni sorts, et le bouclier compte toujours dans la CA
 * (data/actor/templates/attributes.mjs:290-296).
 */

/** Les caractéristiques dont les tests d20 ont le Désavantage. */
export const UNTRAINED_ABILITIES = Object.freeze(["str", "dex"]);

const untrained = item => !!item && (Number(item.system?.proficiencyMultiplier ?? 1) === 0);

/** L'armure portée sans formation, ou null (un personnage seulement). */
export function untrainedArmor(actor) {
  if ( actor?.type !== "character" ) return null;
  const armor = actor.system.attributes?.ac?.equippedArmor ?? null;
  return untrained(armor) ? armor : null;
}

/** Le bouclier porté sans formation, ou null (un personnage seulement). */
export function untrainedShield(actor) {
  if ( actor?.type !== "character" ) return null;
  const shield = actor.system.attributes?.ac?.equippedShield ?? null;
  return untrained(shield) ? shield : null;
}

/** Ce test d20 (caractéristique) a-t-il le Désavantage de l'armure sans formation ? Rend l'armure, ou null. */
export function armorHampers(actor, ability) {
  return UNTRAINED_ABILITIES.includes(ability) ? untrainedArmor(actor) : null;
}

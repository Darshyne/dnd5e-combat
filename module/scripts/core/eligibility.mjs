/**
 * Qui une action peut affecter (SPEC §16.8) : type de créature et immunités. Fonctions pures, aucune dépendance à Foundry.
 *
 * Ce que dnd5e 6.0.3 fait déjà, et qui n'est PAS repris ici :
 *  - immunités, résistances, vulnérabilités aux DÉGÂTS : `Actor5e#applyDamage` → `calculateDamage`, par lequel le
 *    moteur applique tous ses dégâts ;
 *  - immunité à un ÉTAT : l'état est retiré des états de la créature (`prepareResistImmune`, data/actor/templates/
 *    traits.mjs) et l'effet d'état est suspendu (data/active-effect/condition.mjs, `isSuppressed`).
 *
 * Ce que le système ne fait pas, et que le moteur ajoute :
 *  - « Choisissez un Humanoïde » : aucune donnée d'activité ne restreint le type de la cible (\`target.affects.type\`
 *    vaut « creature ») — le contenu le déclare (\`targets.types\`) ;
 *  - un effet qui groupe plusieurs états (Motif hypnotique : Charmé ET Neutralisé) reste posé avec ses autres états
 *    sur une créature immunisée contre l'un d'eux ; or ces états découlent tous du premier. Règle du moteur : une
 *    créature immunisée contre UN des états d'un effet ne reçoit pas cet effet ;
 *  - une action qui ne ferait rien d'autre que poser des effets que la créature ne peut pas recevoir ne l'affecte pas
 *    du tout : pas de sauvegarde demandée pour rien.
 */

/** Les types de créature de dnd5e 6 (`CONFIG.DND5E.creatureTypes`), pour valider le contenu hors de Foundry. */
export const CREATURE_TYPES = Object.freeze([
  "aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid",
  "monstrosity", "ooze", "plant", "undead"
]);

/**
 * Le type de la créature est-il permis ? Pas de restriction, ou type inconnu (fiche sans type) : oui — on ne refuse
 * jamais par ignorance.
 * @param {string[]|null|undefined} types  Types permis (contenu `targets.types`).
 * @param {string|null} creatureType
 */
export function typeAllowed(types, creatureType) {
  if ( !types?.length || !creatureType ) return true;
  return types.includes(creatureType);
}

/** Les états d'un effet contre lesquels la créature est immunisée (vide : l'effet peut être posé). */
export function blockedStatuses(statuses, immunities) {
  const immune = new Set(immunities ?? []);
  return Array.from(statuses ?? []).filter(s => immune.has(s));
}

/**
 * L'action n'affecte-t-elle pas du tout la créature ? Oui si elle ne fait que poser des effets (ni dégâts, ni soin,
 * ni étape d'issue) et que chacun d'eux porte un état contre lequel la créature est immunisée.
 * @param {object} plan
 * @param {boolean} plan.damage          L'action inflige des dégâts ou soigne.
 * @param {boolean} plan.steps           Elle a des étapes d'issue (poussée, état posé par le moteur).
 * @param {string[][]} plan.effects      Les états de chacun de ses effets.
 * @param {string[]} immunities
 * @returns {string|null}  Le premier état qui bloque, ou null.
 */
export function immuneToAll({ damage=false, steps=false, effects=[] }, immunities) {
  if ( damage || steps || !effects.length ) return null;
  let first = null;
  for ( const statuses of effects ) {
    const blocked = blockedStatuses(statuses, immunities);
    if ( !blocked.length ) return null;
    first ??= blocked[0];
  }
  return first;
}

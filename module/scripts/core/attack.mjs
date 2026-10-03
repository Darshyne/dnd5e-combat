/**
 * Résolution d'un jet d'attaque contre des cibles. Règles 2024 : un 20 naturel touche toujours
 * et c'est un coup critique, un 1 naturel rate toujours. Aucune dépendance à Foundry.
 */

/**
 * @typedef {object} AttackRoll
 * @property {number} total        Total du jet, modificateurs compris.
 * @property {boolean} isCritical  Le d20 atteint le seuil de critique de l'attaquant.
 * @property {boolean} isFumble    Le d20 est un échec automatique (1 naturel).
 */

/**
 * @typedef {object} AttackTarget
 * @property {string} token   UUID du token ciblé.
 * @property {string} name
 * @property {number|null} ac CA de la cible ; `null` = abri total, l'attaque ne peut pas toucher.
 */

/**
 * @param {AttackRoll} roll
 * @param {AttackTarget[]} targets
 * @returns {Array<AttackTarget & {hit: boolean, critical: boolean, reason: string}>}
 */
export function resolveAttack(roll, targets) {
  return targets.map(target => {
    let hit;
    let reason;
    if ( target.ac === null || target.ac === undefined ) { hit = false; reason = "cover"; }
    else if ( roll.isFumble ) { hit = false; reason = "fumble"; }
    else if ( roll.isCritical ) { hit = true; reason = "critical"; }
    else { hit = roll.total >= target.ac; reason = hit ? "ac" : "miss"; }
    return { ...target, hit, critical: hit && roll.isCritical, reason };
  });
}

/**
 * §39.2 : le mode d'attaque d'une arme qui se lance, avant le dialogue du jet. dnd5e reprend le DERNIER mode utilisé
 * (activity/attack.mjs:95, drapeau `last.<activité>.attackMode`) : après un lancer de dague, une attaque au contact
 * repartait en « lancer » (jugée à distance : désavantage au contact d'un ennemi, portée de lancer). Un mode repris de
 * la mémoire n'est donc pas un choix : contre une cible à l'allonge, un « lancer » mémorisé redevient le mode par défaut.
 * @param {object} data
 * @param {string|null} data.requested      Le mode de la configuration du jet (dnd5e, ou demandé par un appelant).
 * @param {string|null} data.remembered     Le dernier mode mémorisé par dnd5e pour cette activité.
 * @param {string|null} data.byDefault      Le premier mode de l'arme (celui de dnd5e par défaut).
 * @param {boolean} data.hasTargets         Des cibles sont désignées.
 * @param {boolean} data.allBeyondReach     Toutes les cibles sont hors d'allonge.
 * @param {boolean} data.canThrow           L'arme a un mode « lancer ».
 * @returns {string|null}  Le mode à imposer, ou null pour laisser la configuration telle quelle.
 */
export function throwableAttackMode({ requested, remembered, byDefault, hasTargets, allBeyondReach, canThrow }) {
  const fromMemory = !!requested && (requested === remembered);
  // Un autre mode que celui par défaut, demandé explicitement (main secondaire, deux mains) : on le garde.
  if ( requested && (requested !== byDefault) && !fromMemory ) return null;
  if ( !hasTargets ) return null;
  if ( allBeyondReach && canThrow ) return (requested === "thrown") ? null : "thrown";
  // Une cible à l'allonge : un « lancer » repris de la mémoire redevient le mode par défaut.
  if ( fromMemory && requested.startsWith("thrown") && byDefault && (byDefault !== requested) ) return byDefault;
  return null;
}

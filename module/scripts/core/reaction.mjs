/**
 * Réactions (SPEC §7) : une fenêtre s'ouvre à un moment précis d'une résolution, et seulement si
 * quelqu'un peut y répondre. Fonctions pures, aucune dépendance à Foundry.
 *
 * Fenêtres connues :
 *  - "isHit"        l'attaque vient de toucher la créature, avant les dégâts (Bouclier)
 *  - "isDamaged"    la créature vient de subir des dégâts (Représailles infernales)
 *  - "leavesReach"  une créature hostile quitte l'allonge (attaque d'opportunité)
 */

/**
 * Les réactions qu'une créature peut proposer dans une fenêtre.
 * @param {Array<{on: string[]}>} declared   Déclarations canoniques de ses items (core/triggers.mjs).
 * @param {string} window
 * @param {{reactionAvailable: boolean, incapacitated?: boolean}} state
 */
export function eligibleReactions(declared, window, { reactionAvailable, incapacitated=false }) {
  if ( !reactionAvailable || incapacitated ) return [];
  return declared.filter(r => r.on.includes(window));
}

/** Deux camps sont-ils opposés ? Un neutre (0) ou un secret (-2) ne provoque ni ne subit rien. */
export function areHostile(a, b) {
  return ((a === 1) && (b === -1)) || ((a === -1) && (b === 1));
}

/**
 * Qui peut tenter une attaque d'opportunité contre une créature qui vient de se déplacer.
 * On compare la position de départ et d'arrivée : sortir de l'allonge puis y revenir dans le même
 * déplacement n'est pas vu (limite assumée).
 * @param {object} mover
 * @param {number} mover.disposition
 * @param {boolean} mover.disengaged   A pris l'action Se désengager ce tour.
 * @param {boolean} mover.teleported   Téléportation ou déplacement forcé : pas d'attaque d'opportunité.
 * @param {Array<{token: string, disposition: number, before: number, after: number, reach: number,
 *   reactionAvailable: boolean, incapacitated?: boolean, hasMeleeAttack: boolean, seesMover?: boolean|null,
 *   hasLineOfEffect?: boolean|null}>} others
 *   `before`, `after` et `reach` dans la même unité ; `seesMover` : « une créature que vous pouvez
 *   voir » (règle 2024) — false l'exclut, null (inconnu) ne l'exclut pas ; `hasLineOfEffect` : peut-elle
 *   frapper celui qui bouge (pas de plancher, de plafond ni d'abri total entre eux — P2, §14.2) ? Même règle.
 * @returns {string[]}  UUID des tokens qui peuvent réagir.
 */
export function opportunityAttackers(mover, others) {
  if ( mover.disengaged || mover.teleported ) return [];
  return others.filter(o =>
    o.hasMeleeAttack && o.reactionAvailable && !o.incapacitated && (o.seesMover !== false) && (o.hasLineOfEffect !== false)
    && areHostile(mover.disposition, o.disposition)
    && (o.before <= o.reach + 1e-6) && (o.after > o.reach + 1e-6)
  ).map(o => o.token);
}

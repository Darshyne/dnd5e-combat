/**
 * Invocation pilotée (SPEC §16.15, B19) : un objet invoqué que le lanceur commande pendant SON tour — Arme spirituelle,
 * Sphère de feu, Main de Bigby. « Par une action Bonus lors de vos tours suivants, vous pouvez déplacer [l'objet] de X m
 * et [agir] » : une COMMANDE coûte l'activation déclarée (l'action Bonus) au lanceur, et ouvre un déplacement borné plus
 * une utilisation d'une activité de l'objet, qui la clôt. Au tour du lancement, `onCast` donne une commande
 * gratuite : `use` (l'Arme spirituelle attaque « immédiatement », sans bouger) ou `command` (la Main de Bigby bouge et agit).
 *
 * L'état d'une commande est tenu par objet et par tour du lanceur (`turn` = clé du tour) ; un état d'un autre tour ne
 * compte pas. Les trois sorts disent « déplacer … puis agir » : l'utilisation clôt le déplacement de la commande (la Sphère
 * de feu « s'arrête pour le tour » en heurtant une créature). Fonctions pures.
 */

/**
 * @typedef {object} CommandState
 * @property {string} turn     Clé du tour du lanceur où la commande a été payée.
 * @property {boolean} paid    Une commande est ouverte ce tour-ci (payée, ou offerte au lancement).
 * @property {boolean} move    Elle permet de déplacer l'objet.
 * @property {number} used     Utilisations d'activité faites dans cette commande (une au plus).
 */

/** L'état valable pour ce tour, ou null. */
export function currentCommand(state, turnKey) {
  return (state && (state.turn === turnKey)) ? state : null;
}

/**
 * Ce que coûte un geste de l'objet piloté, et l'état qui en résulte. Un geste que la commande ouverte ne couvre plus
 * (seconde attaque, déplacement après une attaque gratuite de lancement) en ouvre une nouvelle, au prix de `cost` : le
 * budget du lanceur dira alors s'il reste de quoi payer.
 * @param {CommandState|null} state  L'état du tour (`currentCommand`).
 * @param {"move"|"use"} gesture
 * @param {string} cost              Activation d'une commande (« bonus »).
 * @param {string} turnKey
 * @returns {{pay: string|null, next: CommandState}}
 */
export function planCommand(state, gesture, cost, turnKey) {
  const open = currentCommand(state, turnKey);
  if ( gesture === "use" ) {
    if ( open?.paid && ((open.used ?? 0) < 1) ) return { pay: null, next: { ...open, move: false, used: 1 } };
    return { pay: cost, next: { turn: turnKey, paid: true, move: false, used: 1 } };
  }
  if ( open?.paid && open.move ) return { pay: null, next: open };
  return { pay: cost, next: { turn: turnKey, paid: true, move: true, used: 0 } };
}

/** La commande offerte au tour du lancement (`onCast`), ou null. */
export function castCommand(onCast, turnKey) {
  if ( !onCast ) return null;
  return { turn: turnKey, paid: true, move: onCast === "command", used: 0 };
}

/**
 * §38.2 : Troc du filou (Duperie 6) — l'action Bonus qui crée ou déplace l'illusion d'Invoquer la duplicité permet aussi au clerc
 * de permuter sa place avec elle par téléportation. Hors combat : toujours. En combat : pendant le tour
 * du lanceur, une fois par tour, si l'illusion a été créée ce tour-ci (`createdTurn`) ou déplacée par une commande payée ce tour-ci.
 * @param {{inCombat: boolean, ownTurn: boolean, turnKey: string|null, command: CommandState|null, createdTurn: string|null,
 *   usedTurn: string|null}} state
 * @returns {boolean}
 */
export function canTranspose({ inCombat, ownTurn, turnKey, command, createdTurn=null, usedTurn=null }) {
  if ( !inCombat ) return true;
  if ( !ownTurn || !turnKey || (usedTurn === turnKey) ) return false;
  const moved = !!command && (command.turn === turnKey) && command.paid && command.move;
  return moved || (createdTurn === turnKey);
}
/**
 * Index du prochain tour à jouer quand certains combattants ne jouent pas (objets pilotés : ils agissent pendant le tour
 * de leur lanceur). `direction` : 1 en avançant, -1 en reculant. Rend -1 ou `skip.length` si l'on sort du round.
 * @param {boolean[]} skip   Pour chaque tour, dans l'ordre du combat : ce combattant est-il sauté ?
 * @param {number} from      Tour visé par le cœur.
 * @param {1|-1} direction
 */
export function nextPlayableTurn(skip, from, direction=1) {
  let turn = from;
  while ( (turn >= 0) && (turn < skip.length) && skip[turn] ) turn += direction;
  return turn;
}

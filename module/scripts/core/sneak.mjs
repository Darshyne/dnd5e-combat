/**
 * Attaque sournoise et Frappes rusées du Roublard (SPEC §20, Manuel des joueurs 2024). Fonctions pures.
 *
 * Attaque sournoise : au plus une fois par tour, des dés de dégâts en plus (du type de l'arme) sur un coup porté avec une arme
 * de Finesse ou à distance, à deux conditions possibles : l'attaque a l'Avantage, ou bien un allié non Neutralisé se tient à
 * 1,50 m de la cible et l'attaque n'a pas le Désavantage.
 *
 * Frappes rusées (niveau 5) : au moment des dégâts de l'Attaque sournoise, le roublard peut sacrifier certains de ses dés pour
 * y greffer un effet, chaque effet ayant son prix en dés. Deux effets au niveau 11
 * (Frappe rusée améliorée), trois de plus au niveau 14 (Frappes sournoises).
 */

/** Le mode d'avantage d'un jet de dnd5e (`advantageMode`) : 1 avantage, -1 désavantage, 0 ni l'un ni l'autre. */
export const ADVANTAGE = 1;
export const DISADVANTAGE = -1;

/**
 * Pourquoi l'Attaque sournoise ne s'applique pas, ou null si elle s'applique.
 * @param {object} attack
 * @param {boolean} attack.weapon          L'attaque est faite avec une arme (pas un sort, pas une attaque à mains nues).
 * @param {boolean} attack.finesse         L'arme a la propriété Finesse.
 * @param {boolean} attack.rangedWeapon    C'est une arme à distance (pas une arme de corps à corps lancée).
 * @param {number} attack.advantageMode    Le mode du jet d'attaque, une fois avantage et désavantage combinés.
 * @param {boolean} attack.allyNear        Un allié non Neutralisé de l'attaquant à 1,50 m de la cible.
 * @param {boolean} [attack.spent]         L'Attaque sournoise a déjà servi ce tour.
 * @param {boolean} [attack.anyWeapon]     §72 : toute arme convient (Attaque sournoise d'un PNJ).
 * @param {boolean} [attack.freeTarget]    §72 : la cible est d'un type contre lequel rien n'est requis (« si la cible est un mort-vivant »).
 * @returns {"spent"|"notWeapon"|"weaponKind"|"disadvantage"|"noAdvantage"|null}
 */
export function sneakAttackIssue({ weapon, finesse, rangedWeapon, advantageMode, allyNear, spent=false, anyWeapon=false, freeTarget=false }) {
  if ( spent ) return "spent";
  if ( !weapon ) return "notWeapon";
  if ( !anyWeapon && !finesse && !rangedWeapon ) return "weaponKind";
  if ( freeTarget ) return null;
  if ( advantageMode === ADVANTAGE ) return null;
  if ( advantageMode === DISADVANTAGE ) return "disadvantage";
  return allyNear ? null : "noAdvantage";
}

/**
 * Le nombre de dés et leur taille d'une formule d'Attaque sournoise (« 3d6 »), ou null si elle ne se lit pas ainsi.
 * @param {string} formula
 * @returns {{number: number, faces: number}|null}
 */
export function parseDice(formula) {
  const m = String(formula ?? "").replace(/\s+/g, "").match(/^(\d+)d(\d+)$/i);
  return m ? { number: Number(m[1]), faces: Number(m[2]) } : null;
}

/** Les dés d'Attaque sournoise d'un roublard de ce niveau (table du Roublard : 1d6 au niveau 1, +1d6 tous les deux niveaux). */
export function sneakDiceAtLevel(level) {
  const n = Math.ceil((Number(level) || 0) / 2);
  return n > 0 ? { number: n, faces: 6 } : null;
}

/**
 * Les Frappes rusées qu'on peut proposer : chacune coûte `cost` dés, et il faut en garder au moins le coût.
 * @param {Array<{key: string, cost: number, available?: boolean}>} options   `available: false` : une condition manque (trousse
 *                                                                              d'empoisonneur, taille de la cible).
 * @param {number} dice
 * @returns {Array<{key: string, cost: number}>}
 */
export function affordableStrikes(options, dice) {
  return (options ?? []).filter(o => (o.available !== false) && (o.cost > 0) && (o.cost <= dice));
}

/**
 * Le choix de l'auteur, remis dans les règles : chaque effet au plus une fois, pas plus de `max` effets, et un coût total qui
 * tient dans les dés. Ce qui dépasse est écarté, dans l'ordre du choix.
 * @param {string[]} chosen
 * @param {Array<{key: string, cost: number}>} options   Celles qu'on pouvait choisir (affordableStrikes).
 * @param {{dice: number, max: number}} limits
 * @returns {{strikes: string[], cost: number, dice: number}}  `dice` : ceux qui restent à lancer.
 */
export function settleStrikes(chosen, options, { dice, max }) {
  const byKey = new Map((options ?? []).map(o => [o.key, o]));
  const strikes = [];
  let cost = 0;
  for ( const key of chosen ?? [] ) {
    const option = byKey.get(key);
    if ( !option || strikes.includes(key) || (strikes.length >= max) || ((cost + option.cost) > dice) ) continue;
    strikes.push(key);
    cost += option.cost;
  }
  return { strikes, cost, dice: dice - cost };
}

/**
 * Assassinat (Assassin, niveau 3) : au premier round d'un combat, Avantage contre toute créature qui n'a pas encore agi.
 * Une créature a joué son tour au premier round si elle passe avant le
 * combattant dont c'est le tour (ordre de l'initiative) ; celle dont c'est le tour est en train de le jouer.
 * @param {{round: number, turn: number, targetTurn: number|null}} combat   `targetTurn` : rang de la cible dans l'ordre du
 *                                                                           combat, null si elle n'y est pas.
 */
export function hasNotActedYet({ round, turn, targetTurn }) {
  if ( round !== 1 ) return false;
  if ( !Number.isInteger(targetTurn) ) return true;   // hors du combat (surprise, arrivée tardive) : elle n'a pas joué
  return targetTurn > turn;
}

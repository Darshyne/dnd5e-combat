/**
 * Ce que le moteur publie pour une interface externe (SPEC §40.1) : `game.modules.get("dnd5e-combat").api.ui`. Lecture
 * seule, sur n'importe quel client ; aucune règle ici — les mêmes lectures que le tracker (ui/budget.mjs), le contrôle de
 * légalité (runtime/turn.mjs `useIssues`) et le plafond de déplacement (runtime/actions.mjs `movementCap`). Le moteur ne
 * connaît aucune interface : une interface qui recopiait ces calculs (flag `turn` du combattant, historique du token) les
 * lit ici.
 */

import { reactionAvailable, movementAllowance } from "../core/turn.mjs";
import { combatantFor, currentTurnKey, isOwnTurn, readBudget, movementOf, historyCosts } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { multiattackLeft } from "../adapter/multiattack.mjs";
import { movementCap } from "../runtime/actions.mjs";
import { useIssues } from "../runtime/turn.mjs";
import { lightState, globalLightState } from "./illumination.mjs";
import { menuEntriesFor } from "./pointer.mjs";
import { poolsOf } from "../adapter/absorb.mjs";

/**
 * Le budget du tour d'un combattant, tel que le moteur le juge : une action reste disponible tant que l'action Attaquer a
 * des attaques à donner ; la réaction suit « pas deux dans le même tour » (§19.6). null hors d'un combat commencé.
 * Qui a le droit de le voir est l'affaire de l'interface (le tracker du moteur : ui/budget.mjs `budgetVisible`).
 * @param {Combatant} combatant
 * @returns {{action: boolean, bonus: boolean, reaction: boolean, attacks: {used: number, granted: number, left: number},
 *            dashed: boolean, disengaged: boolean, dodging: boolean, ownTurn: boolean}|null}
 */
function budget(combatant) {
  if ( !combatant?.actor || !combatant.combat?.started ) return null;
  const b = readBudget(combatant);
  const left = Math.max(0, b.attacks.granted - b.attacks.used);
  return {
    action: (b.action > 0) || (left > 0), bonus: b.bonus > 0, reaction: reactionAvailable(b, currentTurnKey()),
    attacks: { used: b.attacks.used, granted: b.attacks.granted, left },
    dashed: !!b.dashed, disengaged: !!b.disengaged, dodging: !!b.dodging, ownTurn: isOwnTurn(combatant)
  };
}

/**
 * Le déplacement du tour d'un token en combat, dans l'unité de la grille : dépensé (escaliers et relevé compris,
 * téléportations exclues), permis (vitesse, Foncer, déplacement ouvert par un effet), et ce qui reste **réellement** — le
 * plafond que le moteur applique à la marche (victime traînée, tour achevé par un ordre). null hors combat ou sans vitesse.
 * @param {Token|TokenDocument} token
 * @returns {{spent: number, allowance: number, left: number, speed: number, units: string, dashed: boolean}|null}
 */
function movement(token) {
  const doc = token?.document ?? token;
  const combatant = doc?.actor ? combatantFor(doc.actor) : null;
  const m = combatant ? movementOf(combatant, readUnitFactors()) : null;
  if ( !m ) return null;
  const b = readBudget(combatant);
  const allowance = movementAllowance(b, m.speed);
  // Le plafond se compare à l'historique du cœur, téléportations comprises (runtime/actions.mjs `movementCap`).
  const history = historyCosts(doc);
  const cap = movementCap(doc);
  const left = b.stopped ? 0 : Math.max(0, Number.isFinite(cap) ? cap - history.spent - history.excluded : allowance - m.spent);
  return { spent: m.spent, allowance, left, speed: m.speed, units: m.units, dashed: !!b.dashed };
}

/**
 * Ce qui cloche si cette activité était utilisée maintenant, avant de savoir qui elle vise (budget et tour, emplacement déjà
 * lancé ce tour, Silence, limites d'usage, états qui empêchent d'agir, Rage) : les raisons, traduites ; vide = rien.
 * @param {Activity} activity
 * @param {{cost?: string|null, attackMode?: string|null, recast?: boolean}} [options]
 * @returns {string[]}
 */
function issues(activity, options={}) {
  return activity?.actor ? useIssues(activity, options).lines : [];
}

/**
 * §18.19 : ce qui reste des Attaques multiples ouvertes ce tour par cet acteur — uuids des items encore jouables (`left`),
 * de ceux du plan qui n'ont plus rien (`spent`), noms des premiers. null sans plan ouvert.
 * @param {Actor5e} actor
 * @returns {{left: string[], spent: string[], names: string[]}|null}
 */
function multiattack(actor) {
  const combatant = actor ? combatantFor(actor) : null;
  const multi = combatant ? readBudget(combatant).multi : null;
  const status = multi ? multiattackLeft(actor, multi) : null;
  return status ? { left: [...status.left], spent: [...status.spent], names: [...status.names] } : null;
}

/**
 * §108 : les réserves qui absorbent les dégâts de cet acteur, actives (Égide arcanique créée depuis le dernier repos long) :
 * points restants et maximum (les utilisations de l'item, adapter/absorb.mjs). Vide sans réserve active.
 * @param {Actor5e} actor
 * @returns {Array<{name: string, img: string, identifier: string, value: number, max: number}>}
 */
function wards(actor) {
  return poolsOf(actor).map(({ item, pool }) => ({ name: item.name, img: item.img, identifier: item.system.identifier ?? "",
    value: pool, max: Number(item.system.uses?.max) || pool }));
}

export const uiApi = { budget, wards, movement, issues, multiattackLeft: multiattack, light: lightState, globalLight: globalLightState,
  /** §41.4 : `tokenMenu(token)` — les entrées du menu contextuel de ce token pour le token en main (ui/pointer.mjs). */
  tokenMenu: menuEntriesFor };

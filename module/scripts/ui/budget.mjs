/**
 * Le budget du tour tel que l'interface le montre (SPEC §6, §9.1) — le tracker de combat — et ce
 * qu'un clic y demande. Une interface externe lit le même budget par `api.ui` (ui/api.mjs, §40.1). Aucune règle ici : le budget
 * vient d'adapter/turn.mjs, les changements de core/turn.mjs.
 */

import { dash, disengage, dodge, toggleResource, movementAllowance } from "../core/turn.mjs";
import { isOwnTurn, readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { multiattackLeft } from "../adapter/multiattack.mjs";
import { loc } from "../runtime/shared.mjs";

export const RESOURCES = ["action", "bonus", "reaction"];

/** Les gestes communs du tour, dans l'ordre d'affichage : clé, libellé, drapeau du budget qui dit « déjà fait ». */
export const COMMONS = [["dash", "Foncer", "dashed"], ["disengage", "SeDesengager", "disengaged"], ["dodge", "Esquiver", "dodging"]];

/** Un joueur voit le budget de ses combattants et de ceux des autres joueurs, pas celui des PNJ du MJ. */
export const budgetVisible = combatant => !!combatant?.actor && (combatant.isOwner || combatant.hasPlayerOwner);

const round = n => Math.round(n * 10) / 10;

/**
 * Ce que l'interface affiche du budget d'un combattant.
 * @param {Combatant} combatant
 */
export function budgetView(combatant) {
  const budget = readBudget(combatant);
  const editable = combatant.isOwner;
  const ownTurn = isOwnTurn(combatant);
  // Une action reste disponible tant que l'action Attaquer a des attaques à donner.
  const attacksLeft = budget.attacks.used < budget.attacks.granted;
  const resources = RESOURCES.map(key => ({
    key, label: loc(`Pastille.${key}`),
    available: (budget[key] > 0) || ((key === "action") && attacksLeft)
  }));
  let attacks = null;
  if ( (budget.attacks.granted > 1) && (budget.attacks.granted < 99) ) {
    // §18.19 : Attaques multiples ouvertes — ce qui reste, nommé.
    const status = budget.multi ? multiattackLeft(combatant.actor, budget.multi) : null;
    attacks = {
      used: budget.attacks.used, granted: budget.attacks.granted,
      text: loc("Attaques", { used: budget.attacks.used, granted: budget.attacks.granted }),
      tooltip: status ? (status.names.length ? loc("AttaquesRestantes", { names: status.names.join(", ") }) : loc("AttaquesEpuisees")) : null
    };
  }
  const m = movementOf(combatant, readUnitFactors());
  let movement = null;
  if ( m ) {
    const allowance = movementAllowance(budget, m.speed);
    movement = { spent: round(m.spent), allowance: round(allowance), units: m.units, over: m.spent > allowance + 1e-6,
      left: round(Math.max(0, allowance - m.spent)) };
  }
  const commons = COMMONS.map(([key, label, flag]) => ({
    key, label: loc(label), done: !!budget[flag],
    // Pendant son tour seulement, et contre une action.
    enabled: editable && ownTurn && !budget[flag] && (budget.action >= 1)
  }));
  return { editable, ownTurn, resources, attacks, movement, commons };
}

/** Un clic du propriétaire : corriger une ressource (`action`, `bonus`, `reaction`) ou faire un geste commun. */
export async function applyBudgetIntent(combatant, key) {
  if ( !combatant?.isOwner ) return;
  const current = readBudget(combatant);
  const common = { dash, disengage, dodge }[key];
  if ( !common && !RESOURCES.includes(key) ) return;
  await writeBudget(combatant, common ? common(current) : toggleResource(current, key));
}

/**
 * Des tours d'affilée (`extraTurns`, core/extra-turns.mjs) : Arrêt du temps. À l'utilisation, en combat, le nombre de tours est tiré
 * (jet visible) et noté sur le lanceur ; à chaque fin de son tour, tant qu'il en reste, le MJ actif ramène le combat sur lui. Ce qui y
 * met fin plus tôt (« si une de vos actions affecte une autre créature ») reste au MJ : retirer le drapeau, ou passer le tour à la main
 * en arrière puis en avant, n'est pas nécessaire — un retour arrière du tracker ne consomme rien.
 */

import { MODULE_ID } from "../constants.mjs";
import { takesAnotherTurn, movedForward } from "../core/extra-turns.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

const FLAG = "extraTurns";

async function onPostUse(activity, usageConfig, results) {
  const rule = activity?.item ? contentOf(activity.item).entry?.extraTurns : null;
  const actor = activity?.actor;
  const combat = game.combat;
  if ( !rule || !results?.message || !actor || !combat?.started ) return;
  if ( !combat.combatants.some(c => c.actorId === actor.id) ) return;
  // La formule est celle de la règle (« 1d4 + 1 »), sans donnée de l'activité : rien à monter au niveau de lancement.
  const roll = await new Roll(rule.formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc("ToursAffilee.Jet", { item: activity.item.name, n: roll.total }) });
  await actor.setFlag(MODULE_ID, FLAG, { combat: combat.id, left: roll.total, item: activity.item.name });
  log(`${activity.item.name}: ${actor.name} takes ${roll.total} turns in a row`);
}

async function onTurnChange(combat, prior, current) {
  const ended = combat.combatants.get(prior?.combatantId);
  const actor = ended?.actor;
  const state = actor?.getFlag(MODULE_ID, FLAG) ?? null;
  if ( !takesAnotherTurn(state, { combat: combat.id, forward: movedForward(prior, current) }) ) {
    // Un drapeau d'un autre combat, ou épuisé : on le retire quand son porteur finit un tour.
    if ( state && ((state.combat !== combat.id) || !(state.left > 0)) ) await actor.unsetFlag(MODULE_ID, FLAG);
    return;
  }
  const left = state.left - 1;
  if ( left > 0 ) await actor.setFlag(MODULE_ID, FLAG, { ...state, left });
  else await actor.unsetFlag(MODULE_ID, FLAG);
  await combat.update({ round: prior.round, turn: prior.turn });
  log(`${state.item}: ${actor.name} takes another turn (${left} left)`);
}

export function registerExtraTurns() {
  route("dnd5e.postUseActivity", onPostUse, { label: "turns in a row: number not rolled" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "turns in a row: turn not given back" });
}

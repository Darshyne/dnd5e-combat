/**
 * §129 : dons d'origine du Manuel des joueurs, au jet de dégâts (sur le client de l'auteur, `dnd5e.preRollDamageV2`).
 *
 *  - Sauvagerie martiale (`savageAttacker`) : une fois par tour, au jet de dégâts d'une arme (pas une attaque à mains nues), ses dés
 *    sont lancés deux fois et le meilleur gardé (core/feats.mjs, `twiceKeepHighest`). Le choix « l'un ou l'autre » est toujours le
 *    meilleur : pas de question. Hors combat, chaque coup.
 *  - Guérisseur (`healingRerolls`) : aux dés de soins d'un sort, un 1 relancé une fois (`rerollOnesOnce`). Les Soins de combat du don
 *    portent déjà la relance dans leurs données.
 * Ailleurs : Bagarreur de tavernes (faveur `hitRider`, adapter/smite.mjs), Chanceux (`rollBonus.luck`, adapter/inspiration.mjs ; sa
 * fenêtre avant une attaque, content/feats.mjs), Vigilant (`initiativeSwap`, runtime/roll-bonus.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { twiceKeepHighest, rerollOnesOnce } from "../core/feats.mjs";
import { contentOf } from "../adapter/content.mjs";
import { combatantFor } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const hasRule = (actor, key) => Array.from(actor?.items ?? []).some(i => contentOf(i).entry?.[key] === true);

/** Le tour de combat où se bat l'acteur (« combat.round.tour »), ou null hors combat. */
function turnOf(actor) {
  const combat = combatantFor(actor)?.parent ?? null;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const actor = activity?.actor;
  if ( !actor || !config.rolls?.length ) return true;
  // Guérisseur : les dés de soins d'un sort.
  if ( (activity.type === "heal") && (activity.item?.type === "spell") && hasRule(actor, "healingRerolls") ) {
    for ( const roll of config.rolls ) roll.parts = (roll.parts ?? []).map(rerollOnesOnce);
    log(`Healer: 1s rerolled once on ${activity.item.name}'s healing dice`);
  }
  // Sauvagerie martiale : la part de l'arme d'un coup d'arme, une fois par tour.
  const weapon = (activity.type === "attack") && (activity.item?.type === "weapon") && (activity.attack?.type?.classification !== "unarmed");
  if ( weapon && hasRule(actor, "savageAttacker") ) {
    const turn = turnOf(actor);
    if ( turn && (actor.getFlag(MODULE_ID, "savageAttacker") === turn) ) return true;
    const base = config.rolls.find(r => r.base) ?? config.rolls[0];
    base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? twiceKeepHighest(p) : p));
    foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.savageAttacker`, true);
    if ( turn ) actor.setFlag(MODULE_ID, "savageAttacker", turn).catch(() => null);
    log(`Savage Attacker: ${base.parts[0]}`);
  }
  return true;
}

export function registerFeats() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "origin feats (damage)" });
}

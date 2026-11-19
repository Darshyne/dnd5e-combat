/**
 * Un sort lancé « dans la même action », sans emplacement (clé `freeCast` : Intervention divine). L'activité de l'aptitude, qui
 * coûte l'action et l'utilisation, retient le lancement sur le lanceur (`flags["dnd5e-combat"].freeCast`) ; le sort suivant qui
 * convient part sans emplacement et sans coût d'action (core/free-cast.mjs), puis la retenue est oubliée. Les composantes
 * matérielles ne sont pas vérifiées par le moteur : rien à lever. Inscrit avant registerTurn, comme la Métamagie.
 */

import { MODULE_ID } from "../constants.mjs";
import { freeCastApplies, freeCastHeld } from "../core/free-cast.mjs";
import { contentOf } from "../adapter/content.mjs";
import { currentTurnKey } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

const ruleOf = activity => {
  const rule = activity?.item ? contentOf(activity.item).entry?.freeCast : null;
  return (rule && (rule.activity === activity.id)) ? rule : null;
};

/** Le lancement gratuit que cet acteur retient encore, avec sa règle, ou null. */
function heldBy(actor) {
  const held = actor?.getFlag?.(MODULE_ID, "freeCast");
  if ( !freeCastHeld(held, { turn: currentTurnKey(), now: game.time?.worldTime ?? 0 }) ) return null;
  const item = actor.items.get(held.item);
  const rule = item ? contentOf(item).entry?.freeCast : null;
  return rule ? { rule, item } : null;
}

const spellFacts = activity => ({ isSpell: activity.item?.type === "spell", level: Number(activity.item?.system?.level) || 0,
  activation: activity.activation?.type ?? null, sourceClass: activity.item?.system?.sourceClass || null });

function onPreUse(activity, usageConfig) {
  const actor = activity?.actor;
  const held = actor ? heldBy(actor) : null;
  if ( !held || !freeCastApplies(held.rule, spellFacts(activity)) ) return true;
  const ours = (usageConfig[MODULE_ID] ??= {});
  ours.freeCast = held.item.id;
  if ( !ours.cost ) ours.cost = "free";
  usageConfig.consume = { ...((typeof usageConfig.consume === "object") ? usageConfig.consume : {}), spellSlot: false };
  log(`${actor.name}: ${activity.item.name} cast through ${held.item.name}, no slot, same action`);
  return true;
}

async function onPostUse(activity, usageConfig) {
  const actor = activity?.actor;
  if ( !actor?.isOwner ) return;
  const rule = ruleOf(activity);
  if ( rule ) {
    await actor.setFlag(MODULE_ID, "freeCast", { item: activity.item.id, turn: currentTurnKey(), at: game.time?.worldTime ?? 0 });
    const token = actor.getActiveTokens?.(false, true)?.[0];
    if ( token ) notice(token, loc("LancementGratuit.Retenu", { item: activity.item.name }), "gain");
    log(`${actor.name}: ${activity.item.name}, the next spell of level ${rule.maxLevel} or lower is cast without a slot`);
    return;
  }
  if ( usageConfig?.[MODULE_ID]?.freeCast && actor.getFlag(MODULE_ID, "freeCast") ) await actor.unsetFlag(MODULE_ID, "freeCast");
}

export function registerFreeCast() {
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "free cast: spell not modified" });
  route("dnd5e.postUseActivity", (activity, usageConfig) => onPostUse(activity, usageConfig), { label: "free cast not held" });
}

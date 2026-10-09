/**
 * Métamagie (SPEC §32) : l'option choisie (son activité, qui dépense les points de Sorcellerie) est retenue sur l'ensorceleur, puis
 * portée par le sort suivant — Sort accéléré : son coût devient l'action Bonus (coût imposé, lu par la légalité et la dépense,
 * runtime/turn.mjs) ; les autres options sont lues à la résolution (adapter/usage.mjs, adapter/saves.mjs), par la portée
 * (adapter/turn.mjs) et par la fenêtre du Contresort (runtime/gates.mjs). Inscrit avant registerTurn.
 */

import { MODULE_ID } from "../constants.mjs";
import { metamagicKindOf, pendingMetamagic, addMetamagic, clearMetamagic } from "../adapter/metamagic.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

function onPreUse(activity, usageConfig) {
  const actor = activity?.actor;
  if ( (activity?.item?.type !== "spell") || !actor ) return true;
  const kinds = pendingMetamagic(actor);
  if ( !kinds.length ) return true;
  const ours = (usageConfig[MODULE_ID] ??= {});
  ours.metamagic = kinds;
  // Sort accéléré : « un sort dont le temps d'incantation est égal à 1 action ».
  if ( kinds.includes("quickened") && (activity.activation?.type === "action") && !ours.cost ) ours.cost = "bonus";
  return true;
}

async function onPostUse(activity) {
  const actor = activity?.actor;
  if ( !actor?.isOwner ) return;
  const kind = metamagicKindOf(activity);
  if ( kind ) {
    const kinds = await addMetamagic(actor, kind);
    const token = actor.getActiveTokens?.(false, true)?.[0];
    if ( token ) notice(token, loc("Metamagie.Retenue", { item: activity.item.name }), "gain");
    log(`${actor.name}: Metamagic held for the next spell (${kinds.join(", ")})`);
    return;
  }
  if ( (activity.item?.type === "spell") && pendingMetamagic(actor).length ) {
    log(`${actor.name}: Metamagic applied to ${activity.item.name} (${pendingMetamagic(actor).join(", ")})`);
    await clearMetamagic(actor);
  }
}

export function registerMetamagic() {
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "metamagic: spell not modified" });
  route("dnd5e.postUseActivity", activity => onPostUse(activity), { label: "metamagic not held" });
}

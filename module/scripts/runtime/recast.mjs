/**
 * Sorts qui se relancent tant qu'ils durent (SPEC §16.21, clé `recast`) : Appel de la foudre — « tant que le sort dure,
 * vous pouvez faire une action Magie pour appeler de nouveau la foudre ». dnd5e 6 n'a qu'une activité : l'utiliser de
 * nouveau dépenserait un emplacement et relancerait la concentration. Tant que la concentration du sort tient, le moteur
 * relance donc la même utilisation sans emplacement (`consume.spellSlot: false`), sans nouvelle concentration
 * (`concentration.begin: false`), au niveau du lancement initial (`scaling`) — options de l'utilisation que dnd5e lit
 * (documents/activity/mixin.mjs:468, 494, 502). L'activation (l'action) reste due : le budget la décompte.
 * À inscrire AVANT la souris (ui/pointer.mjs) : la relance repasse par la visée et la légalité.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { stormOf, cloudOf } from "../adapter/storm.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** Le niveau d'emplacement au-dessus du niveau du sort, lu sur le dernier lancement « vrai » de l'item. */
function castScaling(item) {
  const messages = game.messages.contents;
  for ( let i = messages.length - 1; i >= Math.max(0, messages.length - 200); i-- ) {
    const m = messages[i];
    if ( (m.type !== "usage") || m.getFlag(MODULE_ID, "recast") || m.getFlag(MODULE_ID, "areaTick") ) continue;
    if ( m.system?.item?.uuid !== item.uuid ) continue;
    return Number(m.system?.scaling) || 0;   // `system.scaling` du message d'utilisation (niveaux au-dessus du sort)
  }
  return 0;
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  if ( usageConfig[MODULE_ID]?.recast || !activity?.item ) return true;
  if ( !contentOf(activity.item).entry?.recast || !concentrationOn(activity.item) ) return true;
  const consume = (usageConfig.consume && (typeof usageConfig.consume === "object")) ? usageConfig.consume : {};
  // dnd5e recalcule `scaling` d'après l'emplacement choisi : on lui donne celui du lancement, qui ne sera pas dépensé.
  const scaling = castScaling(activity.item);
  const config = {
    ...usageConfig,
    consume: { ...consume, spellSlot: false },
    concentration: { ...(usageConfig.concentration ?? {}), begin: false },
    scaling,
    ...(scaling > 0 ? { spell: { ...(usageConfig.spell ?? {}), slot: `spell${(activity.item.system.level ?? 0) + scaling}` } } : {}),
    [MODULE_ID]: { ...(usageConfig[MODULE_ID] ?? {}), recast: true }
  };
  // §70 : un sort à orage dont le nuage est là — pas de nouvelle zone à poser : l'éclair se vise dessous (ui/pointer.mjs).
  if ( stormOf(activity.item) && cloudOf(activity.item) ) config.create = { ...(usageConfig.create ?? {}), measuredTemplate: false };
  log(`${activity.item.name} : relancé sans emplacement (concentration en cours)`);
  activity.use(config, { ...(dialogConfig ?? {}), configure: false }, messageConfig);
  return false;
}

export function registerRecast() {
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "relance d'un sort qui dure" });
}

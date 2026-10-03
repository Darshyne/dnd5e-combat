/**
 * M8 (SPEC §18.13) : Régénération au début du tour de la créature, coupée pour son prochain tour par les dégâts que son texte
 * nomme (Acide ou Feu pour le Troll). Un troll à 0 PV ne meurt qu'au début d'un tour où il ne régénère pas
 * (adapter/death.mjs le garde Inconscient d'ici là).
 */

import { MODULE_ID } from "../constants.mjs";
import { regenerationAtTurnStart, stopsRegeneration } from "../core/regeneration.mjs";
import { setDeathStatus, dropAutoDead, ensureDowned } from "../adapter/death.mjs";
import { regenerationOf, isStopped, markStopped, clearStopped, regenerate } from "../adapter/regeneration.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** Sur le client qui applique les dégâts : les types réellement subis, gardés pour après l'écriture. */
function onCalculateDamage(actor, damages, options) {
  if ( !regenerationOf(actor)?.stoppedBy.length ) return;
  const types = damages.filter(d => (d.value > 0) && d.type).map(d => d.type);
  if ( types.length ) (options[MODULE_ID] ??= {}).damageTypes = types;
}

async function onApplyDamage(actor, amount, options) {
  const regeneration = regenerationOf(actor);
  const types = options?.[MODULE_ID]?.damageTypes ?? [];
  if ( !regeneration || !stopsRegeneration(regeneration.stoppedBy, types) ) return;
  await markStopped(actor, types);
  log(`${actor.name} : ${regeneration.item.name} coupée pour son prochain tour (${types.join(", ")})`);
}

function onTurnChange(combat, prior, current) {
  const token = combat.combatants.get(current?.combatantId)?.token;
  const actor = token?.actor;
  const regeneration = regenerationOf(actor);
  if ( !regeneration ) return;
  return enqueue(`turn:${token.uuid}`, async () => {
    // La Mort d'office de dnd5e, si elle est encore là, n'est pas une mort (adapter/death.mjs, dropAutoDead).
    await dropAutoDead(actor);
    const hp = actor.system.attributes?.hp?.value ?? 0;
    const stopped = isStopped(actor);
    const what = regenerationAtTurnStart({ hp, stopped, dead: actor.statuses.has("dead"), ...regeneration });
    if ( stopped ) await clearStopped(actor);
    if ( what === "dies" ) {
      await setDeathStatus(actor, "dead");
      log(`${actor.name} : commence son tour à 0 PV sans régénérer → Mort`);
    } else if ( what === "heal" ) {
      const n = await regenerate(actor, regeneration);
      log(`${actor.name} : ${regeneration.item.name} +${n} PV`);
    } else if ( stopped ) log(`${actor.name} : ${regeneration.item.name} ne fonctionne pas ce tour-ci`);
  });
}

/** dnd5e vient de poser sa Mort d'office sur une créature qui régénère : Inconscient à la place. MJ actif. */
async function onCreateEffect(effect) {
  const actor = actorOfEffect(effect);   // un token non lié : l'effet est dans son ActorDelta
  if ( !actor || !effect.getFlag("dnd5e", "autoDowned") || !effect.statuses.has("dead") ) return;
  if ( await dropAutoDead(actor) ) {
    await ensureDowned(actor);
    log(`${actor.name} : 0 PV, mais régénère — Inconscient, pas Mort`);
  }
}

export function registerRegeneration() {
  route("createActiveEffect", onCreateEffect, { executor: true, label: "régénération : Mort d'office retirée" });
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "régénération : types de dégâts non lus" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "régénération : coupure non notée" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "régénération au début du tour" });
}

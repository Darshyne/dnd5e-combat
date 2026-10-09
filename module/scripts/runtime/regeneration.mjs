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
  const regeneration = regenerationOf(actor);
  if ( !regeneration?.stoppedBy.length && !regeneration?.silveredBy?.length ) return;
  const hurt = damages.filter(d => (d.value > 0) && d.type);
  const types = hurt.map(d => d.type);
  // §78 : une arme argentée (propriété « sil » du jet, dnd5e : DamageDescription.properties).
  const silvered = hurt.filter(d => d.properties?.has?.("sil")).map(d => d.type);
  if ( types.length ) Object.assign((options[MODULE_ID] ??= {}), { damageTypes: types, silveredTypes: silvered });
}

async function onApplyDamage(actor, amount, options) {
  const regeneration = regenerationOf(actor);
  const types = options?.[MODULE_ID]?.damageTypes ?? [];
  const silvered = options?.[MODULE_ID]?.silveredTypes ?? [];
  if ( !regeneration || !stopsRegeneration(regeneration.stoppedBy, types, regeneration.silveredBy ?? [], silvered) ) return;
  await markStopped(actor, types);
  log(`${actor.name}: ${regeneration.item.name} stopped for their next turn (${types.join(", ")})`);
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
      log(`${actor.name}: starts their turn at 0 Hit Points without regenerating -> Dead`);
    } else if ( what === "heal" ) {
      const n = await regenerate(actor, regeneration);
      log(`${actor.name}: ${regeneration.item.name} +${n} Hit Points`);
    } else if ( stopped ) log(`${actor.name}: ${regeneration.item.name} doesn't function this turn`);
  });
}

/** dnd5e vient de poser sa Mort d'office sur une créature qui régénère : Inconscient à la place. MJ actif. */
async function onCreateEffect(effect) {
  const actor = actorOfEffect(effect);   // un token non lié : l'effet est dans son ActorDelta
  if ( !actor || !effect.getFlag("dnd5e", "autoDowned") || !effect.statuses.has("dead") ) return;
  if ( await dropAutoDead(actor) ) {
    await ensureDowned(actor);
    log(`${actor.name}: 0 Hit Points, but regenerates - Unconscious, not Dead`);
  }
}

export function registerRegeneration() {
  route("createActiveEffect", onCreateEffect, { executor: true, label: "regeneration: automatic Dead removed" });
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "regeneration: damage types not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "regeneration: stop not recorded" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "regeneration at start of turn" });
}

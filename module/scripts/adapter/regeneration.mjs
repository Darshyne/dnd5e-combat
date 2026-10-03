/**
 * M8 (SPEC §18.13) : la Régénération d'un acteur vue depuis Foundry — l'item (contenu `regeneration`, par identifiant), son
 * activité de soin, ce que dit le texte anglais d'origine — et la marque « coupée » posée par les dégâts qui l'arrêtent.
 */

import { MODULE_ID } from "../constants.mjs";
import { readRegeneration } from "../core/regeneration.mjs";
import { contentOf } from "./content.mjs";
import { englishDescription } from "./multiattack.mjs";

/** @returns {{item: Item5e, activity: Activity, needsHp: boolean, stoppedBy: string[], survivesZero: boolean}|null} */
export function regenerationOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    if ( contentOf(item).entry?.regeneration !== true ) continue;
    const activity = item.system.activities?.find(a => (a.type === "heal") && a.healing?.formula);
    if ( !activity ) continue;
    return { item, activity, ...readRegeneration(englishDescription(item)) };
  }
  return null;
}

export const isStopped = actor => !!actor?.getFlag(MODULE_ID, "regenerationStopped");

export async function markStopped(actor, types) {
  if ( !isStopped(actor) ) await actor.setFlag(MODULE_ID, "regenerationStopped", types);
}

export async function clearStopped(actor) {
  if ( isStopped(actor) ) await actor.unsetFlag(MODULE_ID, "regenerationStopped");
}

/** Le soin de la Régénération : la formule de l'activité, un jet dans le chat, puis les PV rendus par le système. */
export async function regenerate(actor, regeneration) {
  const { activity, item } = regeneration;
  const roll = await new Roll(activity.healing.formula, activity.getRollData()).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: item.name });
  await actor.applyDamage([{ value: roll.total, type: "healing" }]);
  return roll.total;
}

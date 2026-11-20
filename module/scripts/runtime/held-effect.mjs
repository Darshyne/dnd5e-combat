/**
 * La règle `heldEffect` (Paume vibratoire) : un effet de l'item qu'une seule créature porte à la fois, et qu'une activité de l'item
 * fait cesser une fois résolue. MJ actif.
 */

import { STEPS } from "../core/action.mjs";
import { supersededEffects, endsHeldEffect } from "../core/held-effect.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { log } from "./shared.mjs";

/** Les effets de la scène posés depuis cet effet de cet item. */
function heldEffectsOf(item, effectId) {
  const out = [];
  for ( const token of canvas?.scene?.tokens ?? [] ) {
    for ( const e of token.actor?.effects ?? [] ) {
      if ( !comesFromItemEffect(e, effectId) || (originItemOf(e)?.uuid !== item.uuid) ) continue;
      out.push({ id: e.id, bearer: token.actor.uuid, effect: e });
    }
  }
  return out;
}

/** Un effet tenu vient d'être posé : les autres porteurs le perdent (« une seule créature à la fois »). */
export async function onHeldEffectCreated(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return;
  const item = originItemOf(effect);
  const rule = item ? contentOf(item).entry?.heldEffect : null;
  if ( !rule || !comesFromItemEffect(effect, rule.effect) ) return;
  const old = supersededEffects(rule, { id: effect.id, bearer: effect.parent.uuid }, heldEffectsOf(item, rule.effect));
  for ( const { effect: e } of old ) {
    await e.delete().catch(() => null);
    log(`${item.name}: "${e.name}" leaves ${e.parent?.name} (one creature at a time)`);
  }
}

const seen = new Set();

/** L'activité qui met fin à l'effet est résolue : l'effet tombe, où qu'il soit. */
export async function onHeldEffectEnded(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || seen.has(resolution.id) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const item = activity?.item;
  const rule = item ? contentOf(item).entry?.heldEffect : null;
  if ( !endsHeldEffect(rule, activity?.id) ) return;
  seen.add(resolution.id);
  const actorItem = activity.actor?.items?.get(item.id) ?? item;
  for ( const { effect } of heldEffectsOf(actorItem, rule.effect) ) {
    await effect.delete().catch(() => null);
    log(`${item.name}: "${effect.name}" ends on ${effect.parent?.name} (${activity.name || activity.id})`);
  }
}

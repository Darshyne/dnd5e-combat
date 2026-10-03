/**
 * Fins de sorts (SPEC §42.2) : ce qui suit la fin d'un effet.
 *
 *  - `effectThen` (MJ actif) : quand un effet d'item cesse sur une créature — durée écoulée, concentration rompue, dissipation,
 *    retrait à la main —, un autre effet du même item y est posé. Hâte : « quand le sort prend fin, la cible est Neutralisée et sa
 *    Vitesse est de 0 jusqu'à la fin de son prochain tour » (l'effet « Lethargy », que `effectEnds` fait tomber à la fin du
 *    prochain tour du porteur, runtime/cantrips.mjs).
 * Les autres fins vivent avec leur brique : sauvegarde répétée et dégâts au tour du porteur (runtime/triggers.mjs), effet rompu
 * par ce que fait son porteur (`breaksOn`, runtime/breaks.mjs), fin à un tour précis (`effectEnds`, runtime/cantrips.mjs).
 */

import { contentOf } from "../adapter/content.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { potionOfCast } from "../adapter/potions.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

async function onDeleteEffect(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const item = originItemOf(effect);
  // §53 : le sort qu'une potion a fait lancer n'a pas de suite (Rapidité : « sans la vague de léthargie » de Hâte).
  const rules = (item && !potionOfCast(item)) ? contentOf(item).entry?.effectThen : null;
  if ( !rules ) return;
  const key = Object.keys(rules).find(id => comesFromItemEffect(effect, id));
  if ( !key ) return;
  // Une créature à 0 PV n'a plus rien à subir ; un acteur de token supprimé avec son token non plus.
  if ( (actor.system?.attributes?.hp?.value ?? 0) <= 0 ) return;
  if ( actor.isToken ? !actor.token?.parent?.tokens?.has(actor.token.id) : !game.actors.has(actor.id) ) return;
  return enqueue(`effectThen:${actor.uuid}`, async () => {
    const placed = await placeItemEffect(item, rules[key], actor, { scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0 });
    if ( placed ) log(`${item.name} : « ${effect.name} » cesse sur ${actor.name}, « ${placed.name} » posé`);
  });
}

export function registerEndings() {
  route("deleteActiveEffect", onDeleteEffect, { executor: true, label: "fin d'effet : effet suivant non posé" });
}

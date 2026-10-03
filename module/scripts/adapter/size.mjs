/**
 * Changer de taille (SPEC §16.58). L'effet qu'un item déclare (`resize`, par l'id de l'effet de l'item) reçoit, à sa
 * création sur la cible, un changement `system.traits.size` en phase « initial » : la catégorie de la cible décalée de
 * ses crans (core/size.mjs). Le reste est à dnd5e 6 : avec le réglage « Autosize » (`tokenSizeSync`), la taille calculée
 * de l'acteur devient celle du token (`applyActiveEffects`, dnd5e.mjs:42855-42867), que le MJ actif écrit sur le token
 * (`_onOverrideSize`, :93403) — et quand l'effet tombe, le token reprend sa taille. Le moteur lit la source du token :
 * il voit la nouvelle taille une fois écrite.
 */

import { shiftSize } from "../core/size.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** L'id de l'effet de l'item dont `effect` est la copie appliquée (`_stats.duplicateSource` ou `compendiumSource`, dnd5e). */
function sourceEffectId(effect) {
  const uuid = effect?._stats?.duplicateSource ?? effect?._stats?.compendiumSource ?? "";
  return uuid.match(/ActiveEffect\.([A-Za-z0-9]{16})$/)?.[1] ?? null;
}

/**
 * Le changement de taille à ajouter à un effet qu'on crée sur un acteur, ou null.
 * @param {ActiveEffect} effect  l'effet en création (sa copie appliquée)
 * @param {Actor} actor          celui qui le reçoit
 */
export function sizeChangeFor(effect, actor) {
  const id = sourceEffectId(effect);
  const steps = id ? contentOf(originItemOf(effect)).entry?.resize?.[id] : null;
  if ( !steps || !actor?.system?.traits ) return null;
  const size = shiftSize(actor.system.traits.size ?? "med", steps, CONFIG.DND5E.actorSizes.orderedKeys ?? Object.keys(CONFIG.DND5E.actorSizes));
  if ( !size || (size === actor.system.traits.size) ) return null;
  return { key: "system.traits.size", type: "override", value: size, phase: "initial", priority: 50 };
}

/**
 * §53 : les potions — le sort qu'une potion fait lancer ne demande pas de concentration (« no Concentration required », Guide
 * du maître : Clairvoyance, Rapetissement, Forme gazeuse, Croissance, Lecture des pensées, Rapidité ; les données du Rapetissement,
 * de la Clairvoyance… ne retirent pas toutes la propriété). Le reste : adapter/usage.mjs (pour le buveur), adapter/scrolls.mjs
 * (pas un sort lancé), ui/pointer.mjs (rien à viser).
 */

import { potionOfCast, notePotionCast, stampCachedSpell, completeEffectChanges, completeEffectStatuses } from "../adapter/potions.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** `dnd5e.preUseActivity` (après la préparation de l'utilisation, mixin.mjs:500) : pas de concentration à commencer. */
function onPreUse(activity, usageConfig) {
  const potion = potionOfCast(activity?.item);
  if ( !potion || !usageConfig?.concentration?.begin ) return;
  usageConfig.concentration.begin = false;
  log(`${activity.item.name} (${potion.name}) : sans concentration`);
}

export function registerPotions() {
  // L'activité « cast » ne passe pas par `dnd5e.preUseActivity` mais par `dnd5e.preUseLinkedSpell` (activity/cast.mjs:71-90) :
  // la potion existe encore, la copie du sort n'est pas créée.
  route("dnd5e.preUseLinkedSpell", activity => { notePotionCast(activity); }, { label: "potion : incantation non notée" });
  route("dnd5e.preUseActivity", onPreUse, { label: "potion : concentration non retirée" });
  route("preCreateActiveEffect", effect => {
    const n = completeEffectChanges(effect);
    if ( n ) log(`${effect.parent?.name ?? "?"} : ${effect.name} complété (${n} changement(s))`);
    const s = completeEffectStatuses(effect);   // §96
    if ( s ) log(`${effect.parent?.name ?? "?"} : ${effect.name} complété (${s} état(s))`);
  }, { label: "potion : effet non complété" });
  route("preCreateItem", (item, data) => { if ( stampCachedSpell(item, data) ) log(`${item.name} : lancé par une potion`); },
    { label: "potion : sort lancé non marqué" });
}

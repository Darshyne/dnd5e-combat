/**
 * §436 : l'antimagie de dnd5e 6.1 tenue jusqu'au bout.
 *  - Le Champ antimagie du Manuel des joueurs n'a pas le comportement d'activité `antimagic` du SRD 6.1 : à la création de la région de
 *    son gabarit (MJ actif), le moteur y ajoute le comportement de région `dnd5e.antimagic` du système — dnd5e pose alors le statut
 *    `antimagic` sur qui entre, le retire à la sortie, et la région suit le lanceur. Seulement pour un item dont le contenu déclare
 *    `globe.everywhere` (§163), et si dnd5e connaît ce comportement (6.1 et plus).
 *  - La marque `system.magical` que la migration de dnd5e pose sur les effets d'un sort, d'un parchemin ou d'un item `mgc`
 *    (`_migrateEffectMagical`) : sur un item magique ajouté à un acteur, et sur un effet posé sur un acteur depuis un tel item. Sans
 *    elle, `ActiveEffect5e#isSuppressed` ne suspend pas l'effet dans un champ.
 * Le reste lit le statut : légalité (runtime/turn.mjs), éligibilité (adapter/eligibility.mjs), téléportation (runtime/teleport.mjs).
 */

import { ANTIMAGIC_BEHAVIOR } from "../core/antimagic.mjs";
import { contentOf } from "../adapter/content.mjs";
import { antimagicBehaviorKnown, regionHasAntimagic, markItemEffects, markAppliedEffect } from "../adapter/antimagic.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** La région d'un Champ antimagie sans le comportement du système : le lui donner. */
async function onRegionCreated(region) {
  const itemUuid = region.getFlag?.("dnd5e", "item");
  if ( !itemUuid || !antimagicBehaviorKnown() ) return;
  const item = fromUuidSync(itemUuid, { strict: false });
  if ( !item || (contentOf(item).entry?.globe?.everywhere !== true) ) return;
  const activityUuid = region.getFlag("dnd5e", "activity");
  const activity = activityUuid ? fromUuidSync(activityUuid, { strict: false }) : null;
  if ( regionHasAntimagic(region, activity) ) return;
  await region.createEmbeddedDocuments("RegionBehavior", [{ type: ANTIMAGIC_BEHAVIOR, name: item.name }]);
  log(`${item.name}: antimagic region behavior added (${region.name})`);
}

export function registerAntimagic() {
  route("createRegion", region => onRegionCreated(region), { executor: true, label: "antimagic: region behavior not added" });
  route("preCreateItem", item => {
    const n = markItemEffects(item);
    if ( n ) log(`${item.name}: ${n} effect(s) marked magical`);
  }, { label: "antimagic: item effects not marked magical" });
  route("preCreateActiveEffect", effect => {
    if ( markAppliedEffect(effect) ) log(`${effect.parent?.name ?? "?"}: ${effect.name} marked magical`);
  }, { label: "antimagic: applied effect not marked magical" });
}

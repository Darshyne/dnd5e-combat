/**
 * §436 : l'antimagie de dnd5e 6.1 tenue jusqu'au bout.
 *  - Le Champ antimagie du Manuel des joueurs n'a pas le comportement d'activité `antimagic` du SRD 6.1 : à la création de la région de
 *    son gabarit (MJ actif), le moteur y ajoute le comportement de région `dnd5e.antimagic` du système — dnd5e pose alors le statut
 *    `antimagic` sur qui entre, le retire à la sortie, et la région suit le lanceur. Seulement pour un item dont le contenu déclare
 *    `antimagicZone` (content/antimagic.mjs : Champ antimagie, Cône antimagie), et si dnd5e connaît ce comportement (6.1 et plus).
 *  - La marque `system.magical` que la migration de dnd5e pose sur les effets d'un sort, d'un parchemin ou d'un item `mgc`
 *    (`_migrateEffectMagical`) : sur un item magique ajouté à un acteur, et sur un effet posé sur un acteur depuis un tel item. Sans
 *    elle, `ActiveEffect5e#isSuppressed` ne suspend pas l'effet dans un champ.
 * Le reste lit le statut : légalité (runtime/turn.mjs), éligibilité (adapter/eligibility.mjs), téléportation (runtime/teleport.mjs).
 */

import { ANTIMAGIC_BEHAVIOR, ANTIMAGIC_STATUS } from "../core/antimagic.mjs";
import { contentOf } from "../adapter/content.mjs";
import { antimagicBehaviorKnown, regionHasAntimagic, markItemEffects, markAppliedEffect, inAntimagic, magicalUse,
  antimagicSourceName } from "../adapter/antimagic.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";
import { overriddenFlag } from "./forced.mjs";

/** La région d'un Champ antimagie sans le comportement du système : le lui donner. */
async function onRegionCreated(region) {
  const itemUuid = region.getFlag?.("dnd5e", "item");
  if ( !itemUuid || !antimagicBehaviorKnown() ) return;
  const item = fromUuidSync(itemUuid, { strict: false });
  if ( !item || (contentOf(item).entry?.antimagicZone !== true) ) return;
  const activityUuid = region.getFlag("dnd5e", "activity");
  const activity = activityUuid ? fromUuidSync(activityUuid, { strict: false }) : null;
  if ( regionHasAntimagic(region, activity) ) return;
  await region.createEmbeddedDocuments("RegionBehavior", [{ type: ANTIMAGIC_BEHAVIOR, name: item.name }]);
  log(`${item.name}: antimagic region behavior added (${region.name})`);
}

/**
 * Forcer une utilisation que dnd5e refuse sèchement sous le statut : dnd5e 6.1 met `visibility.requireMagic` sur toute activité de sort
 * (dnd5e.mjs:21923, :23234) et cache une activité qui l'exige quand `magicAvailable` est faux (:18849) — `use()` s'arrête alors sur
 * « Using this activity isn't currently possible » (:18914), avant tout hook. Règle de la suite : un refus est forçable. Ici, avant
 * d'appeler `use`, la fenêtre de légalité du moteur (`askAnyway` : alerte au MJ, « Forcé » vu de tous) ; forcé, les effets du statut
 * sont désactivés le temps de l'utilisation puis rétablis, et la carte est marquée `overridden`. `use(extra)` reçoit les clés à fusionner
 * dans la configuration du moteur. Hors de ce cas, `use({})` tel quel.
 * @param {Activity} activity
 * @param {(extra: object) => Promise<any>} use
 */
export async function useDespiteAntimagic(activity, use) {
  const actor = activity?.actor;
  if ( !inAntimagic(actor) || activity.canUse || !magicalUse(activity) ) return use({});
  const item = activity.item;
  const token = usageTokenOf(activity);
  const line = loc(isSpellCast(item) ? "Souci.antimagic" : "Souci.antimagicItem", { item: antimagicSourceName(actor), use: item.name });
  const go = await askAnyway(`${item.name} — ${token?.name ?? actor.name}`, [line], { actor, item, token });
  if ( !go ) return null;
  const lifted = actor.effects.filter(e => e.statuses?.has(ANTIMAGIC_STATUS) && !e.disabled).map(e => e.id);
  await actor.updateEmbeddedDocuments("ActiveEffect", lifted.map(_id => ({ _id, disabled: true })));
  log(`${actor.name}: antimagic lifted for ${item.name} (forced)`);
  try {
    return await use({ antimagicForced: true, overridden: overriddenFlag([line]) });
  } finally {
    const still = lifted.filter(id => actor.effects.get(id));   // sorti du champ entre-temps : dnd5e a retiré l'effet
    if ( still.length ) await actor.updateEmbeddedDocuments("ActiveEffect", still.map(_id => ({ _id, disabled: false })));
  }
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

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
import { antimagicBehaviorKnown, regionHasAntimagic, markItemEffects, markAppliedEffect, antimagicSourceName, antimagicBlocks,
  antimagicBlockedActivities } from "../adapter/antimagic.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { MODULE_ID } from "../constants.mjs";
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
  await markTurnEnd(region, item);
  if ( regionHasAntimagic(region, activity) ) return;
  await region.createEmbeddedDocuments("RegionBehavior", [{ type: ANTIMAGIC_BEHAVIOR, name: item.name }]);
  log(`${item.name}: antimagic region behavior added (${region.name})`);
}

/**
 * Le Cône antimagie dure « jusqu'au début du prochain tour » du tyrannœil (`zoneLasts` : 6 s, la durée hors combat). En combat, l'heure du
 * monde avance au changement de round, avant son tour s'il ne joue pas en premier : la zone note son combattant et le round, et tombe
 * au début de son tour suivant (`onTurnChange`) ; `expiredRegions` (adapter/areas.mjs) l'attend tant que ce combat existe.
 */
async function markTurnEnd(region, item) {
  if ( !contentOf(item).entry?.zoneLasts ) return;
  const combat = game.combat;
  if ( !combat?.started ) return;
  const actor = item.actor;
  const combatant = combat.combatants.find(c => (c.actor === actor) || (c.token?.actor === actor));
  if ( !combatant ) return;
  await region.setFlag(MODULE_ID, "endsOnTurn", { combat: combat.id, combatant: combatant.id, round: combat.round });
  log(`${item.name}: ends at the start of ${combatant.name}'s next turn`);
}

/** Début d'un tour : les zones antimagie de ce combattant posées à un round précédent prennent fin. */
async function onTurnChange(combat, prior, current) {
  const id = current?.combatantId;
  if ( !id ) return;
  for ( const region of Array.from(combat.scene?.regions ?? []) ) {
    const turn = region.getFlag(MODULE_ID, "endsOnTurn");
    if ( !turn || (turn.combat !== combat.id) || (turn.combatant !== id) || !(combat.round > turn.round) ) continue;
    const name = region.name;
    await region.delete();
    log(`area "${name}": start of ${combat.combatants.get(id)?.name ?? "?"}'s turn, removed`);
  }
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
  if ( !antimagicBlocks(activity) ) return use({});
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

/**
 * `api.antimagic.use(subject, usage, dialog, message)` : utiliser un item ou une activité comme dnd5e (`item.use` / `activity.use`, mêmes
 * arguments), mais un sort ou une capacité magique que seul le champ refuse passe par la fenêtre « le faire quand même »
 * (`useDespiteAntimagic`). Pour la barre de Combat UI, qui appelle `activity.use` directement — dnd5e s'arrête avant tout hook. Un item
 * dont une activité reste permise suit dnd5e (son choix d'activité) ; sinon, la première activité que seul le champ refuse.
 * @param {Item|Activity} subject
 */
export async function useAntimagic(subject, usage={}, dialog={}, message={}) {
  const isActivity = !!subject?.item && (subject.documentName !== "Item");
  const item = isActivity ? subject.item : subject;
  if ( !item ) return null;
  let activity = isActivity ? subject : null;
  if ( !activity ) {
    const usable = Array.from(item.system?.activities ?? []).some(a => a.canUse);
    activity = usable ? null : (antimagicBlockedActivities(item)[0] ?? null);
    if ( !activity ) return item.use(usage, dialog, message);
  }
  return useDespiteAntimagic(activity, extra => activity.use(
    foundry.utils.isEmpty(extra) ? usage : { ...usage, [MODULE_ID]: { ...(usage?.[MODULE_ID] ?? {}), ...extra } }, dialog, message));
}

/** Le marqueur d'une carte d'item que le joueur a voulue telle quelle (refus du forçage) : la laisser passer. */
const PLAIN_CARD = "antimagicPlainCard";

/**
 * Depuis la fiche (et tout `item.use` sans activité permise) : dnd5e, ne trouvant aucune activité utilisable, affiche la carte de l'item
 * (`Item5e#use` → `displayCard`, dnd5e.mjs:36020). Si une activité n'est refusée que par le champ, la fenêtre « le faire quand même » à la
 * place ; refusée, la carte part comme dnd5e l'aurait montrée. « Afficher la carte » du menu de la fiche passe aussi par là (dnd5e ne les
 * distingue pas) : le refus rend la même carte.
 */
function onPreDisplayCard(item, message) {
  if ( !item?.actor || message?.[MODULE_ID]?.[PLAIN_CARD] ) return true;
  if ( Array.from(item.system?.activities ?? []).some(a => a.canUse) ) return true;
  const activity = antimagicBlockedActivities(item)[0];
  if ( !activity ) return true;
  (async () => {
    const used = await useDespiteAntimagic(activity, extra => activity.use({ [MODULE_ID]: extra }));
    if ( used === null ) await item.displayCard({ [MODULE_ID]: { [PLAIN_CARD]: true } });
  })().catch(err => console.error(`${MODULE_ID} | antimagic: forced use from the sheet failed`, err));
  return false;
}

export const antimagicApi = Object.freeze({
  use: useAntimagic,
  /** Cette activité n'est-elle refusée que par le champ (donc forçable) ? */
  blocks: activity => antimagicBlocks(activity)
});

export function registerAntimagic() {
  route("createRegion", region => onRegionCreated(region), { executor: true, label: "antimagic: region behavior not added" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "antimagic: cone not ended" });
  route("dnd5e.preDisplayCardV2", onPreDisplayCard, { cancellable: true, label: "antimagic: forcing from the sheet not offered" });
  route("preCreateItem", item => {
    const n = markItemEffects(item);
    if ( n ) log(`${item.name}: ${n} effect(s) marked magical`);
  }, { label: "antimagic: item effects not marked magical" });
  route("preCreateActiveEffect", effect => {
    if ( markAppliedEffect(effect) ) log(`${effect.parent?.name ?? "?"}: ${effect.name} marked magical`);
  }, { label: "antimagic: applied effect not marked magical" });
}

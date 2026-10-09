/**
 * Le choix d'activité de dnd5e, répondu quand il n'y a rien à choisir (SPEC §41.1, §42.1). `Item5e#use` ouvre
 * `ActivityChoiceDialog` pour tout item à plusieurs activités (documents/item.mjs:759 — aucun hook avant lui). Au rendu de la
 * fenêtre, si la règle de core/activity-choice.mjs désigne une activité, on clique son bouton pour le joueur
 * (templates/activity/activity-choices.hbs, `data-action="choose"`) et la fenêtre, rendue invisible, se ferme aussitôt.
 * Aucun patch : le hook de rendu de l'application et son propre bouton. Maj + clic (dnd5e : la première activité, sans
 * fenêtre) et la liste des activités de la fiche restent là pour atteindre les autres.
 *
 * Sur le client de celui qui utilise l'item.
 */

import { activityToUse } from "../core/activity-choice.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, isWounded } from "../adapter/facts.mjs";
import { swallowOf } from "../adapter/swallow.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/**
 * Le sort est-il déjà en cours pour son lanceur ? Il se concentre dessus, ou un effet actif venu de cet item est posé — sur
 * lui (la flamme de Flammes, l'Armure d'Agathys) ou sur une créature de la scène affichée (le Maléfice, la Marque).
 */
function isRunning(item) {
  const actor = item.actor;
  if ( !actor ) return false;
  if ( actor.concentration?.items?.has?.(item) ) return true;
  const mine = effect => !effect.disabled && (originItemOf(effect) === item);
  if ( actor.effects.some(mine) ) return true;
  return (canvas?.scene?.tokens?.contents ?? []).some(t => t.actor && (t.actor !== actor) && t.actor.effects.some(mine));
}

/** Les temps d'incantation qui coûtent quelque chose au tour (§46) — pas « spéciale », « début / fin de tour », ni aucun. */
const COSTS = new Set(["action", "bonus", "reaction", "legendary", "mythic", "lair"]);

function onRenderActivityChoice(app, element) {
  const item = app?.item;
  if ( !item ) return;
  const entry = contentOf(item).entry;
  const buttons = [...element.querySelectorAll('[data-action="choose"][data-activity-id]')];
  const activities = buttons.map(b => item.system.activities?.get(b.dataset.activityId)).filter(Boolean)
    .map(a => ({ id: a.id, timed: !!a.activation?.type, slot: a.consumption?.spellSlot !== false, type: a.type, cost: COSTS.has(a.activation?.type ?? "") }));
  if ( activities.length < 2 ) return;
  const targets = Array.from(game.user.targets).map(t => t.actor).filter(Boolean);
  const wanted = activityToUse({
    activities, level: (item.type === "spell") ? (item.system.level ?? 0) : 0,
    known: !!entry && (Object.keys(entry).length > 0), running: isRunning(item),
    byWounds: entry?.byWounds ?? null, wounded: (targets.length > 0) && targets.every(isWounded),
    // §45 : Avaler / Engloutir — l'activité qui avale ; les autres (dégâts à chaque tour, sortie du cadavre) sont au moteur.
    entry: swallowOf(item)?.entry?.id ?? null
  });
  const button = wanted ? buttons.find(b => b.dataset.activityId === wanted) : null;
  if ( !button ) return;
  log(`${item.name}: activity choice answered (${item.system.activities.get(wanted)?.name ?? wanted})`);
  element.style.visibility = "hidden";   // la fenêtre se ferme au clic : qu'elle ne clignote pas
  button.click();
}

export function registerActivityChoice() {
  route("renderActivityChoiceDialog", onRenderActivityChoice, { label: "activity choice answered" });
}

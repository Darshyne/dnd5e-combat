/**
 * §161 : Clignotement — « lancez 1d6 à la fin de chacun de vos tours pendant la durée ; sur 4 à 6, vous disparaissez de votre plan
 * d'existence et apparaissez dans le plan Éthéré … au début de votre tour suivant, vous revenez ». Contenu `blink` : l'effet du sort
 * qui porte la durée. La donnée y met l'état Éthéré pour toute la durée : il est retiré à la pose (l'effet ne sert plus qu'à compter),
 * et l'état est posé à part, marqué, sur un 4 à 6 en fin de tour, puis retiré au début du tour suivant. MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, comesFromItemEffect } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const ETHEREAL = "ethereal";

/** L'effet de Clignotement que porte l'acteur, ou null. */
function blinkOf(actor) {
  return Array.from(actor?.effects ?? []).find(e => {
    if ( e.disabled || e.isSuppressed ) return false;
    const id = contentOf(originItemOf(e)).entry?.blink;
    return !!id && comesFromItemEffect(e, id);
  }) ?? null;
}

/** À la pose : l'effet de la donnée perd son état Éthéré permanent. */
async function onCreateEffect(effect) {
  if ( (effect.parent?.documentName !== "Actor") || (blinkOf(effect.parent) !== effect) || !effect.statuses?.has(ETHEREAL) ) return;
  // La donnée lui donne « 1 round » (expiration au début du tour suivant) : la durée du sort est d'une minute.
  await effect.update({ statuses: Array.from(effect.statuses).filter(s => s !== ETHEREAL), duration: { value: 60, units: "seconds", expiry: null } });
  log(`${effect.parent.name}: Blink, the d6 decides at the end of each turn`);
}

/**
 * Dans l'ordre de la règle : la fin du tour qui s'achève (le d6), puis le début de celui qui commence (le retour). Le même acteur
 * peut être les deux — seul à combattre, ou les autres sautés : il part sur 4–6 et revient aussitôt, au lieu de passer tout son
 * nouveau tour dans le plan Éthéré (vu le 2026-10-16 : l'échec intermittent de `releve-sorts-6`, le Zombi sauté).
 */
async function onTurnChange(combat, prior, current) {
  await endOfTurn(combat.combatants.get(prior?.combatantId)?.actor);
  await startOfTurn(combat.combatants.get(current?.combatantId)?.actor);
}

/** Fin du tour : le d6. */
async function endOfTurn(actor) {
  const blink = blinkOf(actor);
  if ( !blink ) return;
  const roll = await new Roll("1d6").evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: blink.name });
  if ( roll.total < 4 ) { log(`${actor.name}: Blink, ${roll.total} — stays`); return; }
  const effect = await actor.toggleStatusEffect(ETHEREAL, { active: true });
  if ( effect?.update ) await effect.update({ [`flags.${MODULE_ID}.blink`]: true });
  log(`${actor.name}: Blink, ${roll.total} — to the Ethereal Plane until the start of their next turn`);
}

/** Début du tour : le retour du plan Éthéré. */
async function startOfTurn(actor) {
  const marked = Array.from(actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "blink"));
  if ( !marked.length ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", marked.map(e => e.id));
  log(`${actor.name}: Blink, back from the Ethereal Plane`);
}

export function registerBlink() {
  route("createActiveEffect", onCreateEffect, { executor: true, label: "Blink: permanent Ethereal not removed" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "Blink: d6 not rolled" });
}

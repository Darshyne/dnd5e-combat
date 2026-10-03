/**
 * Une action met fin à un effet (SPEC §43.2) : les effets portés par un acteur que le contenu de leur item d'origine
 * déclare (`actionEnds`) — par le porteur lui-même (Danse irrésistible d'Otto : rejouer la sauvegarde ; Forme gazeuse : y
 * mettre fin) ou par une autre créature au contact (secouer un dormeur). Le test d'un `roll: "check"` est celui que
 * l'item écrit dans son texte, comme pour une entrave (§16.54, adapter/escape.mjs).
 */

import { contentOf } from "./content.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";
import { escapeCheckOf, dcOf } from "./escape.mjs";

/**
 * Les effets d'un acteur auxquels une action de `by` met fin.
 * @param {Actor5e} actor                    Le porteur.
 * @param {"bearer"|"other"} by              Qui prendrait l'action.
 * @returns {Array<{effect: ActiveEffect, item: Item5e, rule: object, check: {ability: string|null, skill: string|null, dc: number}|null}>}
 */
export function actionEndingsOf(actor, by) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    // L'effet de concentration du lanceur vient du même item : il ne porte pas la règle de la cible (§16, B4).
    if ( effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration") ) continue;
    const item = originItemOf(effect);
    const rules = item ? contentOf(item).entry?.actionEnds : null;
    if ( !rules ) continue;
    const key = Object.keys(rules).find(id => comesFromItemEffect(effect, id));
    const rule = key ? rules[key] : null;
    if ( !rule || (rule.by !== by) ) continue;
    let check = null;
    if ( rule.roll === "check" ) {
      const written = escapeCheckOf(item);
      const dc = written ? dcOf(written, item) : null;
      if ( dc === null ) continue;   // pas de test lisible : rien à offrir
      check = { ability: written.ability, skill: written.skill, dc };
    }
    out.push({ effect, item, rule, check });
  }
  return out;
}

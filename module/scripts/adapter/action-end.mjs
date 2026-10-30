/**
 * Une action met fin à un effet (SPEC §43.2) : les effets portés par un acteur que le contenu de leur item d'origine
 * déclare (`actionEnds`) — par le porteur lui-même (Danse irrésistible d'Otto : rejouer la sauvegarde ; Forme gazeuse : y
 * mettre fin) ou par une autre créature au contact (secouer un dormeur). Le test d'un `roll: "check"` est celui que
 * l'item écrit dans son texte, comme pour une entrave (§16.54, adapter/escape.mjs).
 */

import { contentOf } from "./content.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";
import { escapeCheckOf, dcOf } from "./escape.mjs";

/** §288 : le test que pose une activité « check » de l'item (`{ ability, skill, dc }`), ou null. */
export function activityCheckOf(item) {
  const activity = item?.system?.activities?.find?.(a => (a.type === "check") && a.check);
  if ( !activity ) return null;
  const skills = Object.keys(CONFIG.DND5E?.skills ?? {});
  const skill = Array.from(activity.check.associated ?? []).find(s => skills.includes(s)) ?? null;
  const ability = activity.check.ability || null;
  const dc = Number(activity.check.dc?.value ?? activity.check.dc?.formula);
  if ( !Number.isFinite(dc) || (!skill && !ability) ) return null;
  return { ability: ability || null, skill, dc };
}

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
    // §158 : `status:<id>` — un état posé par une étape `status` de l'item (Toile d'araignée : Entravé).
    const key = Object.keys(rules).find(id => id.startsWith("status:") ? effect.statuses?.has?.(id.slice(7)) : comesFromItemEffect(effect, id));
    const rule = key ? rules[key] : null;
    if ( !rule || (rule.by !== by) ) continue;
    let check = null;
    if ( rule.roll === "check" ) {
      const written = escapeCheckOf(item);
      const dc = written ? dcOf(written, item) : null;
      // §288 : à défaut de test lisible dans le texte, celui de l'activité « check » de l'item (Dédale : Intelligence (Investigation) DD 20).
      check = (dc !== null) ? { ability: written.ability, skill: written.skill, dc } : activityCheckOf(item);
      if ( !check ) continue;   // pas de test lisible : rien à offrir
    }
    out.push({ effect, item, rule, check });
  }
  return out;
}

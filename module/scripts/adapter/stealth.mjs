/**
 * §184–§185 : être caché, lu dans Foundry. Un seul état (décision de l'utilisateur, 2026-10-14) : l'effet de Furtivité (action Se
 * cacher, `flags.dnd5e-combat.hidden = { dc }`, adapter/hide.mjs), dans les deux règles du réglage `stealthRules` :
 *  - `2024` : posé par un test de Discrétion DD 15 réussi ; le DD pour le trouver est le total ;
 *  - `bg3`  : posé sans jet quand aucun ennemi ne le voit ; chaque ennemi doit le **repérer** (runtime/stealth.mjs).
 * Un token caché est **invisible pour ses ennemis** (`hiddenFrom`, branché dans `canSee`) — pas pour ses alliés : l'effet ne porte
 * plus l'état Invisible du cœur, qui le cachait aussi au groupe. En BG3, ceux qui l'ont repéré le voient : flag du token
 * `stealth.spottedBy` (ids de tokens), lisible de tous les clients.
 */

import { MODULE_ID } from "../constants.mjs";
import { areEnemies } from "./factions.mjs";
import { settingOr } from "./settings.mjs";
import { knownTo } from "./facts.mjs";

export const RULES_SETTING = "stealthRules";

export function stealthRules() {
  return settingOr(RULES_SETTING, "2024") === "bg3" ? "bg3" : "2024";
}

const doc = t => t?.document ?? t ?? null;

/** Le token (ou l'acteur) est-il caché ? */
export function isHidden(token) {
  const actor = doc(token)?.actor ?? token?.actor ?? (token?.documentName === "Actor" ? token : null);
  return !!actor?.effects?.some?.(e => !e.disabled && e.getFlag?.(MODULE_ID, "hidden"));
}

/** Les tokens qui ont repéré ce token caché (ids, règles BG3). */
export function spottedBy(token) {
  return doc(token)?.getFlag?.(MODULE_ID, "stealth")?.spottedBy ?? [];
}

/**
 * Être caché dérobe-t-il `target` à `observer` ? Un ennemi qui ne l'a pas repéré. Un allié, ou lui-même, le voit toujours.
 */
export function hiddenFrom(observer, target) {
  const o = doc(observer), t = doc(target);
  if ( !o || !t || (o === t) || !isHidden(t) || !areEnemies(o, t) ) return false;
  if ( knownTo(t.actor, o.actor) ) return false;   // §284 : Épine mentale — elle ne peut pas se Cacher de son lanceur
  return !spottedBy(t).includes(o.id);
}

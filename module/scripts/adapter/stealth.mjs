/**
 * §184 : la Furtivité « BG3 » (étape 6d de l'IA des PNJ), lue dans Foundry. Réglage de monde `stealthRules` : `2024` (les règles du
 * Manuel : l'action Se cacher, §16.49 — rien de plus) ou `bg3` : hors combat, un PJ en **mode furtif** (§183) n'est vu d'une créature
 * du MJ qui le regarde (cône compris, §182) que si elle l'a **repéré** — en entrant dans son champ en pleine lumière, ou après deux
 * tests de Discrétion ratés (runtime/stealth.mjs). Qui l'a repéré : flag du token du PJ `stealth.spottedBy` (ids de tokens), lisible
 * de tous les clients (l'Avantage d'une attaque se calcule chez l'attaquant).
 */

import { MODULE_ID } from "../constants.mjs";

export const RULES_SETTING = "stealthRules";

export function stealthRules() {
  try { return game.settings.get(MODULE_ID, RULES_SETTING) === "bg3" ? "bg3" : "2024"; } catch { return "2024"; }
}

const doc = t => t?.document ?? t ?? null;
const playerSide = actor => !!actor && ((actor.type === "character") || !!actor.hasPlayerOwner);
const fighting = d => !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.tokenId === d.id));

/** Le token est-il en mode furtif ? */
export function isSneaking(token) {
  return doc(token)?.getFlag?.(MODULE_ID, "sneaking") === true;
}

/** Les tokens qui ont repéré ce PJ furtif (ids). */
export function spottedBy(token) {
  return doc(token)?.getFlag?.(MODULE_ID, "stealth")?.spottedBy ?? [];
}

/**
 * La furtivité cache-t-elle `target` à `observer` ? Règles BG3, cible en mode furtif hors combat, observateur du MJ hors combat qui ne
 * l'a pas repérée.
 */
export function sneakHides(observer, target) {
  const o = doc(observer), t = doc(target);
  if ( !o || !t || (o === t) || !isSneaking(t) || (stealthRules() !== "bg3") ) return false;
  if ( playerSide(o.actor) || fighting(o) || fighting(t) ) return false;
  return !spottedBy(t).includes(o.id);
}

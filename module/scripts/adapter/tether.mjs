/**
 * Lien lanceur → créature (SPEC §16.43, clé `tether` : Trait ensorcelé), lu et écrit dans Foundry. dnd5e ne pose l'effet
 * « Foudre continue » qu'au toucher ; la règle garde le lien même si l'attaque rate. Le moteur note donc la créature visée par
 * l'attaque, touchée ou ratée : `flags["dnd5e-combat"].tethers.<id d'item>` = uuid de son token, sur le lanceur. Le lien ne vaut
 * que tant que la concentration du sort tient.
 */

import { MODULE_ID } from "../constants.mjs";
import { tetherBreak } from "../core/tether.mjs";
import { convertLength } from "../core/units.mjs";
import { contentOf } from "./content.mjs";
import { concentrationOn } from "./summons.mjs";
import { distanceBetween } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { coverFor, hasLineOfEffect } from "./cover.mjs";
import { tokenOf } from "./vision.mjs";

/** La règle de lien d'un item, ou null. */
export function tetherRuleOf(item) {
  return item ? (contentOf(item).entry?.tether ?? null) : null;
}

/** L'item qui porte cette activité de lien (attaque ou action suivante), et sa règle. */
export function tetherOfActivity(activity) {
  const rule = tetherRuleOf(activity?.item);
  if ( !rule ) return null;
  if ( activity.id === rule.attack ) return { rule, role: "attack" };
  if ( activity.id === rule.activity ) return { rule, role: "follow" };
  return null;
}

/** Le token lié par cet item, tant que sa concentration tient ; sinon null. */
export function tetheredToken(item) {
  const uuid = item?.actor?.getFlag(MODULE_ID, `tethers.${item.id}`);
  if ( !uuid || !concentrationOn(item) ) return null;
  const token = fromUuidSync(uuid, { strict: false });
  return token?.actor ? token : null;
}

/** Note le lien, à l'utilisation de l'attaque (MJ actif). `targetUuid` : le token visé. */
export async function recordTether(item, targetUuid) {
  await item.actor.setFlag(MODULE_ID, `tethers.${item.id}`, targetUuid);
}

/** Oublie le lien (fin du sort). */
export async function clearTether(item) {
  if ( item?.actor?.getFlag(MODULE_ID, `tethers.${item.id}`) ) await item.actor.unsetFlag(MODULE_ID, `tethers.${item.id}`);
}

/** Les items de cet acteur dont le lien est noté. */
export function tetherItems(actor) {
  const tethers = actor?.getFlag(MODULE_ID, "tethers") ?? {};
  return Object.keys(tethers).map(id => actor.items.get(id)).filter(Boolean);
}

/**
 * Le lien est-il rompu ? « sort de sa portée » (distance 3D entre les tokens, unité de la grille) ; « abri total » (murs,
 * surfaces). Rend « range », « cover » ou null (ou null s'il ne se juge pas : scènes différentes, canevas absent).
 */
export function tetherBroken(item) {
  const rule = tetherRuleOf(item);
  const target = tetheredToken(item);
  const caster = tokenOf(item?.actor);
  if ( !rule || !target || !caster || (caster.parent !== target.parent) ) return null;
  let maxRange = rule.range.value;
  try { maxRange = convertLength(rule.range.value, rule.range.units, caster.parent.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  const distance = distanceBetween(caster, target).value;
  const totalCover = (hasLineOfEffect(caster, target) === false) || (coverFor(caster, target, { quiet: true })?.degree === "total");
  return tetherBreak({ distance, maxRange, totalCover });
}

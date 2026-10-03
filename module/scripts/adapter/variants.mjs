/**
 * M5 (SPEC §18.8) : les variantes d'attaque d'un item vues depuis Foundry — noms anglais d'origine des activités (Babele les
 * garde dans `flags.babele.originalPayload.activities[<id>].name`), faits de l'attaquant et de la cible, charge lue dans
 * l'historique de déplacement du tour que tient le cœur V14 (`TokenDocument#movementHistory`, vidé au début du tour).
 */

import { variantsOf, chooseVariant, advantageVariant, straightChargeFeet } from "../core/variants.mjs";
import { convertLength } from "../core/units.mjs";
import { englishDescription } from "./multiattack.mjs";
import { originItemOf } from "./facts.mjs";
import { readUnitFactors } from "./units.mjs";
import { committedPosition } from "./turn.mjs";

/** Le nom anglais d'une activité : celui d'avant Babele, sinon le sien. */
function englishName(item, activity) {
  return item?.flags?.babele?.originalPayload?.activities?.[activity.id]?.name ?? activity.name ?? "";
}

/** Les variantes d'attaque d'un item, ou null. */
export function variantPlanOf(item) {
  if ( !item?.system?.activities ) return null;
  const activities = Array.from(item.system.activities.values?.() ?? []).map(a => ({
    id: a.id, type: a.type, name: englishName(item, a),
    condition: item.flags?.babele?.originalPayload?.activities?.[a.id]?.condition ?? a.activation?.condition ?? "",
    effects: (a.effects ?? []).map(e => e._id ?? e.uuid)
  }));
  return variantsOf(activities, englishDescription(item));
}

const bloodied = actor => {
  const hp = actor?.system?.attributes?.hp;
  return !!hp && (hp.value > 0) && (hp.value <= (hp.max / 2));
};

/** Centre d'un token en cases. */
function centerCells(p, size) {
  return { x: (p.x / size) + ((p.width ?? 1) / 2), y: (p.y / size) + ((p.height ?? 1) / 2) };
}

/** Pieds parcourus en ligne droite vers la cible juste avant l'attaque (core/variants.mjs, `straightChargeFeet`). */
function chargedFeet(attacker, target) {
  const scene = attacker?.parent;
  const grid = scene?.grid;
  if ( !grid?.size || !target ) return 0;
  const here = committedPosition(attacker);
  const history = (attacker.movementHistory ?? []).map(w => ({ ...w, width: w.width ?? here.width, height: w.height ?? here.height }));
  const path = [...history, here].map(p => centerCells(p, grid.size));
  let cellFeet = grid.distance;
  try { cellFeet = convertLength(grid.distance, grid.units, "ft", readUnitFactors()); } catch { /* grille déjà en pieds */ }
  return straightChargeFeet(path, centerCells(committedPosition(target), grid.size), cellFeet);
}

/** La cible est-elle agrippée par l'attaquant (effet Agrippé dont l'origine est un item de l'attaquant) ? */
function grappledBy(target, attacker) {
  for ( const effect of target?.effects ?? [] ) {
    if ( !effect.active || !effect.statuses?.has("grappled") ) continue;
    const item = originItemOf(effect);
    if ( item?.actor && (item.actor === attacker) ) return true;
    if ( attacker?.uuid && String(effect.origin ?? "").startsWith(attacker.uuid) ) return true;
  }
  return false;
}

/**
 * La variante que cette attaque devrait prendre avant le jet, ou null (garder l'activité).
 * On ne change que l'attaque de BASE : une variante choisie à la main est respectée.
 * @param {Activity} activity
 * @param {TokenDocument} attackerToken
 * @param {TokenDocument|null} targetToken
 * @returns {{activity: Activity, kind: string}|null}
 */
export function useTimeVariant(activity, attackerToken, targetToken) {
  const plan = variantPlanOf(activity?.item);
  if ( !plan || (activity.id !== plan.base) ) return null;
  const attacker = activity.actor;
  const target = targetToken?.actor ?? null;
  const id = chooseVariant(plan, {
    selfBloodied: bloodied(attacker),
    targetBloodied: bloodied(target),
    chargedFeet: target ? chargedFeet(attackerToken, targetToken) : 0,
    grappledBySelf: target ? grappledBy(target, attacker) : false
  });
  const chosen = id ? activity.item.system.activities.get(id) : null;
  return chosen ? { activity: chosen, kind: plan.variants.find(v => v.id === id).kind } : null;
}

/** La variante « Attack with Advantage » d'une attaque de base, ou null. */
export function advantageVariantOf(activity) {
  const plan = variantPlanOf(activity?.item);
  const id = (plan && (activity.id === plan.base)) ? advantageVariant(plan) : null;
  return id ? activity.item.system.activities.get(id) : null;
}

/** Les dégâts d'une attaque de base dont le jet avait l'avantage se lancent sur sa variante « with Advantage ». */
export function damageVariant(activity, attackRoll) {
  const plan = variantPlanOf(activity?.item);
  if ( !plan || (activity.id !== plan.base) ) return null;
  const advantage = attackRoll?.hasAdvantage ?? (attackRoll?.options?.advantageMode === 1);
  const id = advantage ? advantageVariant(plan) : null;
  return id ? activity.item.system.activities.get(id) : null;
}

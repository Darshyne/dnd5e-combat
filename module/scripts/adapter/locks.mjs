/**
 * §244 : la serrure d'une porte, lue sur le mur (drapeaux `lock` et `lockTries`), et la clé, cherchée dans les objets de l'acteur.
 * Une clé n'est qu'un objet : le moteur ne sait pas d'où il vient.
 */

import { MODULE_ID } from "../constants.mjs";
import { normalizeLock, normalizeTries, isKey } from "../core/locks.mjs";

export const LOCK_FLAG = "lock";
export const LOCK_TRIES_FLAG = "lockTries";

const docOf = wall => wall?.document ?? wall;

/** La serrure d'un mur (placeable ou document). */
export function lockOf(wall) {
  return normalizeLock(docOf(wall)?.getFlag?.(MODULE_ID, LOCK_FLAG));
}

/** Les essais déjà faits sur cette serrure. */
export function triesOf(wall) {
  return normalizeTries(docOf(wall)?.getFlag?.(MODULE_ID, LOCK_TRIES_FLAG));
}

/** L'objet de l'acteur qui est la clé de cette serrure, ou null. */
export function keyItemFor(actor, lock) {
  if ( !lock?.key || !actor?.items ) return null;
  return actor.items.find(i => isKey({ name: i.name, identifier: i.system?.identifier }, lock.key)) ?? null;
}

/** Le milieu d'une porte, en coordonnées de scène (pour le bruit). */
export function doorPoint(wall) {
  const c = docOf(wall)?.c ?? [0, 0, 0, 0];
  return { x: (c[0] + c[2]) / 2, y: (c[1] + c[3]) / 2 };
}

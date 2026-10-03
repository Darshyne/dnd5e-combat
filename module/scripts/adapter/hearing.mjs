/**
 * L'ouïe (§62) lue dans Foundry : l'observateur entend-il la cible ? Surdité (état Assourdi), cible cachée (effet de Furtivité
 * du moteur, adapter/search.mjs), cible morte, et les murs qui arrêtent le son (moteur de collision `sound` du cœur, au niveau
 * de l'observateur). Positions validées (`_source`). La règle est dans core/hearing.mjs.
 */

import { hears } from "../core/hearing.mjs";
import { committedPosition } from "./turn.mjs";
import { hiddenDcOf } from "./search.mjs";

/** Le centre d'un token à sa position validée, à hauteur de ses pieds. */
function centerOf(doc) {
  const grid = doc.parent.grid;
  const p = committedPosition(doc);
  return { x: p.x + ((p.width ?? 1) * grid.sizeX) / 2, y: p.y + ((p.height ?? 1) * grid.sizeY) / 2, elevation: p.elevation ?? 0 };
}

/** Un mur qui arrête le son sépare-t-il les deux tokens ? */
function soundBlocked(observer, target) {
  const backend = CONFIG.Canvas.polygonBackends?.sound;
  if ( !backend ) return false;
  const level = observer.parent.levels?.get?.(observer.level);
  return backend.testCollision(centerOf(observer), centerOf(target), { type: "sound", mode: "any", level: level ?? undefined }) === true;
}

/**
 * L'observateur entend-il la cible ?
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @returns {boolean}
 */
export function canHear(observer, target) {
  if ( !observer || !target || (observer === target) || target.hidden || (observer.parent !== target.parent) ) return false;
  const statuses = s => target.actor?.statuses?.has(s) ?? false;
  return hears({
    deafened: observer.actor?.statuses?.has("deafened") ?? false,
    hidden: hiddenDcOf(target.actor) !== null,
    silent: statuses("dead"),
    soundBlocked: soundBlocked(observer, target)
  });
}

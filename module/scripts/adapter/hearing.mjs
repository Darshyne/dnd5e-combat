/**
 * L'ouïe (§62) lue dans Foundry : l'observateur entend-il la cible ? Surdité (état Assourdi), cible cachée (effet de Furtivité
 * du moteur, adapter/search.mjs), cible morte, et les murs et planchers qui arrêtent le son (moteur de collision `sound` et
 * Surfaces du cœur, niveaux). Positions validées (`_source`). La règle est dans core/hearing.mjs.
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

/**
 * Un mur ou un plancher qui arrête le son sépare-t-il les deux tokens ? Comme la vue du cœur (detection-mode.mjs:211-259), les
 * murs et les Surfaces (régions `defineSurface`, scene.mjs:836) sont testés séparément : les murs dans le niveau de chacun, les
 * Surfaces de tous les niveaux (un plancher rattaché au seul niveau du dessus arrête aussi le son qui monte). Une cible dans un
 * niveau qu'on ne voit pas depuis le sien (`Level#visibility.levels`, token.mjs:399-417) n'est pas entendue non plus : sinon elle
 * serait « détectée », et le cœur estomperait pour elle l'image du niveau qui la recouvre.
 */
function soundBlocked(observer, target) {
  const scene = observer.parent;
  const levels = scene.levels;
  const own = levels?.get?.(observer.level);
  if ( own && (target.level !== observer.level) && !target.includedInLevel?.(own) ) return true;
  const a = centerOf(observer);
  const b = centerOf(target);
  if ( scene.testSurfaceCollision?.(a, b, { type: "sound", mode: "any" }) === true ) return true;
  const backend = CONFIG.Canvas.polygonBackends?.sound;
  if ( !backend ) return false;
  for ( const id of new Set([observer.level, target.level]) ) {
    const level = levels?.get?.(id);
    if ( backend.testCollision(a, b, { type: "sound", mode: "any", level: level ?? undefined }) === true ) return true;
  }
  return false;
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

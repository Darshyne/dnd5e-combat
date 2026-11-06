/**
 * #33 (suite) : ce que la ligne de visée dessine (ui/attack-line.mjs) — les deux extrémités (centres de l'attaquant, à sa case
 * d'arrivée s'il approche, et de la cible), les tronçons colorés (core/attack-line.mjs) et la distance. Lu sur ce client, avec
 * l'abri de l'aperçu (adapter/cover-preview.mjs) : chez un joueur, une créature qu'il ne perçoit pas ne coupe pas la ligne.
 */

import { attackLineSegments, segmentEntry } from "../core/attack-line.mjs";
import { rangeIssue } from "../core/range.mjs";
import { coverPreviewOf } from "./cover-preview.mjs";
import { coverBodies, rectOf, eyeElevation, canJudgeCover } from "./cover.mjs";
import { canSee } from "./vision.mjs";
import { committedPosition, distanceBetween, rangeOf } from "./turn.mjs";
import { lengthIn, readUnitFactors } from "./units.mjs";

const centre = r => ({ x: r.x + (r.width / 2), y: r.y + (r.height / 2) });

/**
 * Où, sur la ligne de a à b (0–1), se trouve le premier obstacle de l'une de ces sources. D'abord sur l'axe des centres ; si l'axe
 * ne croise rien (l'abri vient des lignes de coin : un pan de mur à côté de l'axe), le premier obstacle sur les lignes du centre de
 * l'attaquant aux coins de la cible, ramené sur l'axe ; null si rien.
 */
function firstObstacle(attacker, target, a, b, pa, sources, seenOnly) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if ( length < 1e-6 ) return null;
  const level = attacker.parent.levels?.get?.(pa.level ?? attacker._source.level) ?? undefined;
  const eye = eyeElevation(attacker, pa);
  const bodies = sources.includes("creature") ? coverBodies(attacker, target, seenOnly).map(t => rectOf(t)) : [];
  // La position d'un point sur l'axe a → b (projection), en fraction.
  const along = p => (((p.x - a.x) * (b.x - a.x)) + ((p.y - a.y) * (b.y - a.y))) / (length * length);
  const hitsOn = end => {
    const hits = [];
    if ( sources.includes("wall") ) {
      const points = CONFIG.Canvas.polygonBackends.move.testCollision({ ...a, elevation: eye }, { ...end, elevation: eye },
        { type: "move", mode: "all", level }) ?? [];
      for ( const p of (Array.isArray(points) ? points : []) ) hits.push(along(p));
    }
    for ( const r of bodies ) {
      const t = segmentEntry(a, end, r);
      if ( t !== null ) hits.push(along({ x: a.x + ((end.x - a.x) * t), y: a.y + ((end.y - a.y) * t) }));
    }
    return hits;
  };
  let hits = hitsOn(b);
  if ( !hits.length ) {
    const inset = attacker.parent.grid.size * 0.1;
    const r = rectOf(target);
    const corners = [{ x: r.x + inset, y: r.y + inset }, { x: r.x + r.width - inset, y: r.y + inset },
      { x: r.x + inset, y: r.y + r.height - inset }, { x: r.x + r.width - inset, y: r.y + r.height - inset }];
    hits = corners.flatMap(hitsOn);
  }
  return hits.length ? Math.max(0, Math.min(1, Math.min(...hits))) : null;
}

/**
 * La ligne de visée d'une attaque, pour ce client ; null hors attaque ou quand la scène n'est pas affichée ici.
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {object} [options.posA]          Position de l'attaquant au bout de son approche.
 * @param {boolean} [options.unreachable]  L'approche n'arrive pas, ou la cible est hors de portée : toute la ligne en rouge.
 * @returns {{from: {x,y}, to: {x,y}, segments: Array, distance: {value: number, units: string}, range: string|null}|null}
 */
export function attackLineOf(attacker, target, activity, { posA, unreachable=false, attackMode=null }={}) {
  if ( (activity?.type !== "attack") || !attacker?.parent || (attacker.parent !== target?.parent) ) return null;
  if ( !canJudgeCover(attacker.parent) ) return null;
  const pa = posA ? { ...committedPosition(attacker), ...posA } : committedPosition(attacker);
  const from = centre(rectOf(attacker, pa));
  const to = centre(rectOf(target));
  const seenOnly = !game.user?.isGM;
  const cover = coverPreviewOf(attacker, target, activity, { posA, attackMode });
  const degree = cover?.degree ?? "none";
  const obstacleAt = (degree !== "none") ? firstObstacle(attacker, target, from, to, pa, cover.sources ?? [], seenOnly) : null;

  const distance = distanceBetween(attacker, target, { posA });
  const range = rangeOf(activity, attackMode);
  const factors = readUnitFactors();
  const issue = rangeIssue(distance, range, factors);
  let rangeEnd = null;
  if ( issue === "outOfRange" ) {
    const reach = lengthIn(range.long ?? range.value, range.units, distance.units, factors);
    rangeEnd = (distance.value > 0) ? Math.max(0, Math.min(1, reach / distance.value)) : 0;
  }
  const unseen = canSee(attacker, target) === false;
  return {
    from, to, distance, range: issue,
    segments: attackLineSegments({ degree, obstacleAt, rangeEnd, unreachable, unseen })
  };
}

/**
 * §162 : les murs du cœur qu'une zone de sort pose (contenu `walls: { move?, sight?, activities? }`) — le long de l'axe de chaque forme
 * « line » (un mur posé par points), sinon sur le pourtour de la région (globe, sphère, cube). Ils portent la région qui les a posés
 * (`flags.dnd5e-combat.zone`) et ses niveaux. Mur de force : arrête le déplacement, pas la vue ; Mur prismatique : arrête la vue, pas
 * le déplacement. MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { lineAxis, polygonEdges } from "../core/wall.mjs";

/** La règle `walls` qui vaut pour cette région (activité qui l'a posée), ou null. */
export function wallRuleOf(region) {
  const uuid = region?.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  const rule = activity?.item ? contentOf(activity.item).entry?.walls : null;
  if ( !rule || (rule.activities && !rule.activities.includes(activity.id)) ) return null;
  return rule;
}

/** Les données des murs d'une région. */
export function wallDataFor(region, rule) {
  const block = CONST.WALL_MOVEMENT_TYPES.NORMAL;
  const sense = CONST.EDGE_SENSE_TYPES.NORMAL;
  const none = CONST.EDGE_SENSE_TYPES.NONE;
  const lines = region.shapes.filter(s => s.type === "line");
  const segments = (lines.length === region.shapes.length) ? lines.map(s => lineAxis(s))
    : region.polygons.flatMap(p => polygonEdges(p.points));
  return segments.map(c => ({
    c,
    move: rule.move === false ? CONST.WALL_MOVEMENT_TYPES.NONE : block,
    sight: rule.sight ? sense : none,
    light: rule.sight ? sense : none,
    sound: none,
    levels: Array.from(region.levels ?? []),
    flags: { [MODULE_ID]: { zone: region.id } }
  }));
}

/** Les murs posés pour cette région. */
export function zoneWallsOf(region) {
  return (region.parent?.walls ?? []).filter(w => w.getFlag(MODULE_ID, "zone") === region.id);
}

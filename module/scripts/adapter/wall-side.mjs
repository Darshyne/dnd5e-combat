/**
 * §169 : un mur à face brûlante (Mur de feu, contenu `wallSide: { distance, units }`). Posé le long des lignes de la grille (sans
 * diagonale) ou en anneau, il est fin : aucune case n'est « dedans ». Ce qui vaut sur la grille :
 *  - à l'apparition, les créatures dont l'espace TOUCHE le mur (des deux côtés) font la sauvegarde (`readActivityRegion`) ;
 *  - ensuite, sans sauvegarde : qui TRAVERSE le mur (« entre dans le mur », une fois par tour), et qui finit son tour du côté
 *    brûlant, à `distance` du mur — une seconde région, posée par le moteur, que le lanceur peut retourner.
 * Le mur porte son côté (`flags.dnd5e-combat.wallSide`), la face brûlante sa région d'origine (`flags.dnd5e-combat.sideOf`).
 * Lecture seulement : runtime/wall-side.mjs écrit, runtime/areas.mjs rejoue.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { committedPosition } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { convertLength } from "../core/units.mjs";
import { wallGeometry, touchesWall, crossesWall } from "../core/wall.mjs";

/** La règle `wallSide` du sort qui a posé cette région (le mur lui-même, pas sa face brûlante), ou null. */
export function wallSideRuleOf(region) {
  if ( !region || region.getFlag?.(MODULE_ID, "sideOf") ) return null;
  const uuid = region.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return activity?.item ? (contentOf(activity.item).entry?.wallSide ?? null) : null;
}

/** La géométrie du mur (segments ou anneau), d'après ses formes. */
export function wallGeometryOf(region) {
  return wallGeometry((region?.shapes ?? []).map(s => s.toObject?.() ?? s));
}

/** La profondeur de la face brûlante, en pixels de la scène. */
export function sideDepthOf(scene, rule) {
  let distance = rule.distance;
  try { distance = convertLength(rule.distance, rule.units, scene.grid.units, readUnitFactors()); } catch {}
  return distance * (scene.grid.size / scene.grid.distance);
}

/** Le rectangle de l'espace d'un token (position validée, ou donnée), en pixels. */
function spaceOf(token, pos=committedPosition(token)) {
  const grid = token.parent.grid;
  return { x: pos.x, y: pos.y, width: (pos.width ?? 1) * grid.sizeX, height: (pos.height ?? 1) * grid.sizeY };
}

/** Le centre d'un token à une position donnée (point de passage), en pixels. */
export function centerAt(token, pos) {
  const r = spaceOf(token, pos);
  return { x: r.x + (r.width / 2), y: r.y + (r.height / 2) };
}

/** L'espace de ce token touche-t-il le mur ? (« dans la zone » à l'apparition.) */
export function touchesWallRegion(region, token) {
  const geometry = wallGeometryOf(region);
  return !!geometry && touchesWall(geometry, spaceOf(token));
}

/** Ce trajet (positions successives du token) traverse-t-il le mur ? */
export function crossesWallRegion(region, token, positions) {
  const geometry = wallGeometryOf(region);
  return !!geometry && crossesWall(geometry, positions.map(p => centerAt(token, p)));
}

/** La face brûlante de ce mur, ou null. */
export function sideRegionOf(wall) {
  return wall?.parent?.regions.find(r => r.getFlag(MODULE_ID, "sideOf") === wall.id) ?? null;
}

/** Le mur dont cette région est la face brûlante, ou null. */
export function wallOfSide(region) {
  const id = region?.getFlag?.(MODULE_ID, "sideOf");
  return id ? (region.parent?.regions.get(id) ?? null) : null;
}

/** Les murs à face brûlante de la scène posés par ce lanceur (son acteur). */
export function wallsOfCaster(token) {
  const actor = token?.actor;
  if ( !actor ) return [];
  return (token.parent?.regions ?? []).filter(r => {
    if ( !wallSideRuleOf(r) || !r.getFlag(MODULE_ID, "wallSide") ) return false;
    const item = fromUuidSync(r.getFlag("dnd5e", "item") ?? "", { strict: false });
    return item?.actor === actor;
  });
}

/**
 * L'espace en trois dimensions, lu dans Foundry pour le cœur (core/space.mjs) — P2, SPEC §14.2.
 *
 *  - **Tranche d'élévation d'une zone de sort.** dnd5e 6 pose la région d'un sort sans hauteur
 *    (`// TODO: Set elevation based on shape's height`, canvas/template-placement.mjs:138) : une
 *    sphère de 20 ft est une colonne infinie. Le moteur la lui donne d'après la forme et la taille
 *    de l'activité, à la pose (hook `dnd5e.createMeasuredTemplate`, dans les données de création :
 *    la région naît avec, et BLFX — qui ne touche pas à une région dont `bottom` et `top` sont finis,
 *    helperFunctions.js:1200 — la laisse), ou après coup pour une région créée sans (connecteur).
 *    Une fois `elevation.bottom/top` écrits, le cœur fait le reste : `TokenDocument#testInsideRegion`
 *    filtre par la tranche (client/documents/token.mjs:3246-3258).
 *  - **Ligne d'effet d'une zone.** Un plancher est une **Surface** (région à comportement
 *    `defineSurface`) : une explosion à l'étage n'atteint pas le dessous si le plancher arrête le
 *    déplacement. Testé par le lancer de rayon 3D de la scène (`Scene#testSurfaceCollision`,
 *    client/documents/scene.mjs:810, type `move` : ce qui arrête un corps arrête un effet) entre le
 *    point d'origine de la zone, à mi-hauteur de sa tranche, et les yeux de la créature.
 *
 * Vérifié dans le cœur 14.368 : `Region.elevation.bottom/top` nullables (null = infini,
 * common/documents/region.mjs:56-59) ; `Scene#getSurfaces` sans `level` rend toutes les surfaces
 * (scene.mjs:793) — un plancher est un plancher, quel que soit le niveau où il est affiché.
 */

import { regionElevationFor, originPointOfShapes, withinSphere } from "../core/space.mjs";
import { convertLength } from "../core/units.mjs";
import { committedPosition } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { eyeElevation } from "./cover.mjs";

let available = false;
export function setSpaceAvailable(value) { available = !!value; }
export function isSpaceAvailable() { return available; }

/** Ce que ce fichier demande au cœur, contrôlé une fois à `ready`. */
export function checkSpaceApi() {
  const missing = [];
  if ( typeof CONFIG.Scene?.documentClass?.prototype?.testSurfaceCollision !== "function" ) missing.push("Scene#testSurfaceCollision");
  if ( typeof CONFIG.Region?.documentClass?.prototype?.includedInLevel !== "function" ) missing.push("Region#includedInLevel");
  return missing;
}

/**
 * Forme et dimensions de la zone d'une activité, unité de la grille. Les dimensions écrites par
 * dnd5e dans les flags de la région (`flags.dnd5e.dimensions`, déjà converties) sont préférées ;
 * sinon on lit l'activité (`target.template`, valeurs préparées en nombres, data/shared/target-field.mjs:145)
 * et on convertit son unité vers celle de la grille.
 * @param {Activity} activity
 * @param {Scene} scene
 * @param {{size?: number, width?: number, height?: number, units?: string}|null} [dimensions]
 * @returns {{type: string, size?: number, width?: number, height?: number}|null}
 */
export function areaOf(activity, scene, dimensions=null) {
  const template = activity?.target?.template;
  const type = template?.type;
  if ( !type ) return null;
  const units = scene.grid.units;
  if ( dimensions && (dimensions.units === units) ) return { type, size: dimensions.size, width: dimensions.width, height: dimensions.height };
  const factors = readUnitFactors();
  const to = v => {
    const n = Number(v);
    if ( !Number.isFinite(n) ) return undefined;
    if ( !template.units ) return n;
    try { return convertLength(n, template.units, units, factors); } catch { return n; }
  };
  return { type, size: to(template.size), width: to(template.width), height: to(template.height) };
}

/**
 * La tranche d'élévation que la zone d'une activité doit recevoir, ou null si on ne sait pas.
 * @param {Activity} activity
 * @param {object} context
 * @param {Scene} context.scene
 * @param {TokenDocument|null} [context.originToken]  Le lanceur : son élévation est celle de la zone.
 * @param {object|null} [context.dimensions]          `flags.dnd5e.dimensions` de la région, s'ils existent.
 * @returns {{bottom: number, top: number, topInclusive: boolean}|null}
 */
export function elevationSliceFor(activity, { scene, originToken=null, dimensions=null }) {
  const area = areaOf(activity, scene, dimensions);
  if ( !area ) return null;
  const origin = originToken ? committedPosition(originToken) : { elevation: 0, depth: 1 };
  const slice = regionElevationFor(area, origin, scene.grid.distance);
  return slice ? { ...slice, topInclusive: false } : null;
}

/** La région a-t-elle déjà une tranche (posée par nous, par BLFX, par le MJ) ? Lue à la source : la préparation met ±Infinity. */
export function hasElevationSlice(region) {
  const { bottom, top } = region._source.elevation ?? {};
  return (bottom !== null && bottom !== undefined) || (top !== null && top !== undefined);
}

/**
 * Pour une région déjà créée sans tranche (connecteur, macro) : la calcule et l'écrit, si la région
 * vient d'une activité. Rend la tranche écrite, ou null.
 * @param {RegionDocument} region
 */
export async function ensureRegionElevation(region) {
  if ( !available || hasElevationSlice(region) ) return null;
  const uuid = region.getFlag("dnd5e", "activity");
  if ( !uuid ) return null;
  const activity = await fromUuid(uuid);
  const originUuid = region.getFlag("dnd5e", "origin");
  const originToken = originUuid ? await fromUuid(originUuid) : null;
  const slice = elevationSliceFor(activity, { scene: region.parent, originToken, dimensions: region.getFlag("dnd5e", "dimensions") ?? null });
  if ( !slice ) return null;
  // Comme dnd5e à la pose (template-placement.mjs:139) : la zone est limitée au niveau du lanceur. Une
  // région créée sans `levels` (connecteur) est « sur tous les niveaux », et BLFX vient alors lui écrire
  // le niveau du lanceur par socket, parfois après que le moteur l'a retirée (« does not exist in the
  // EmbeddedCollection », vu le 2026-09-23) : on le fait d'abord.
  const update = { elevation: slice };
  const level = originToken?._source?.level;
  if ( !region.levels.size && level && region.parent.levels?.has?.(level) ) update.levels = [level];
  await region.update(update);
  return slice;
}

/** Le centre d'un token à sa position validée, en pixels. */
function centerOf(token) {
  const pos = committedPosition(token);
  const grid = token.parent.grid;
  return { x: pos.x + (((pos.width ?? 1) * grid.sizeX) / 2), y: pos.y + (((pos.height ?? 1) * grid.sizeY) / 2) };
}

/**
 * Le point d'origine d'une zone, élevé : le centre de sa forme (le lanceur pour une émanation ou
 * un cône sans origine propre), à mi-hauteur de sa tranche — à défaut de tranche, aux yeux du lanceur.
 * @param {RegionDocument} region
 * @param {TokenDocument|null} originToken
 * @returns {{x: number, y: number, elevation: number}|null}
 */
export function areaOriginOf(region, originToken=null) {
  const attached = region.attachment?.token ? region.parent.tokens.get(region.attachment.token) : null;
  const anchor = attached ?? originToken;
  const fallback = anchor ? centerOf(anchor) : null;
  const point = originPointOfShapes(region.shapes.map(s => s.toObject?.() ?? s), fallback);
  if ( !point ) return null;
  const { bottom, top } = region.elevation;
  const elevation = (Number.isFinite(bottom) && Number.isFinite(top)) ? (bottom + top) / 2
    : (anchor ? eyeElevation(anchor) : (Number.isFinite(bottom) ? bottom : 0));
  return { x: point.x, y: point.y, elevation };
}

/**
 * La sphère d'une zone (sphère ou cercle dnd5e), en pixels : centre de la forme, élévation du lanceur
 * (à mi-hauteur de la tranche), rayon. null pour toute autre forme, ou sans tranche.
 * @param {RegionDocument} region
 * @param {Activity} activity
 * @param {TokenDocument|null} originToken
 * @returns {{x: number, y: number, z: number, radius: number}|null}
 */
export function sphereOf(region, activity, originToken=null) {
  if ( !available ) return null;
  const type = activity?.target?.template?.type;
  if ( (type !== "sphere") && (type !== "circle") ) return null;
  const scene = region.parent;
  const area = areaOf(activity, scene, region.getFlag("dnd5e", "dimensions") ?? null);
  const origin = areaOriginOf(region, originToken);
  if ( !area?.size || !origin ) return null;
  const pxPerUnit = scene.grid.size / scene.grid.distance;
  return { x: origin.x, y: origin.y, z: origin.elevation * pxPerUnit, radius: area.size * pxPerUnit };
}

/** La créature est-elle dans la sphère (et pas seulement dans le cylindre de la région) ? null sans sphère. */
export function insideSphere(sphere, token) {
  if ( !sphere || !token?.parent ) return null;
  const grid = token.parent.grid;
  const pos = committedPosition(token);
  const pxPerUnit = grid.size / grid.distance;
  const box = {
    x0: pos.x, x1: pos.x + (Math.max(pos.width ?? 1, 0.5) * grid.sizeX),
    y0: pos.y, y1: pos.y + (Math.max(pos.height ?? 1, 0.5) * grid.sizeY),
    z0: (pos.elevation ?? 0) * pxPerUnit, z1: ((pos.elevation ?? 0) + ((pos.depth ?? 1) * grid.distance)) * pxPerUnit
  };
  return withinSphere(sphere, box);
}

/**
 * La zone atteint-elle cette créature : aucune surface (plancher, plafond) entre son point
 * d'origine et les yeux de la créature ? null si on ne peut pas le dire (en veille, sans origine).
 * @param {{x: number, y: number, elevation: number}|null} origin
 * @param {TokenDocument} token
 * @returns {boolean|null}
 */
export function reachesFromPoint(origin, token) {
  if ( !available || !origin || !token?.parent || (typeof token.parent.testSurfaceCollision !== "function") ) return null;
  const pos = committedPosition(token);
  const c = centerOf(token);
  const eyes = { x: c.x, y: c.y, elevation: eyeElevation(token, pos) };
  return token.parent.testSurfaceCollision(origin, eyes, { type: "move", mode: "any" }) !== true;
}

/**
 * Niveau de lumière lu sur le canevas (SPEC §16.48) : les sources du cœur passées au calcul pur de core/illumination.mjs.
 *
 * - Lumière globale : `canvas.environment.globalLightSource`, active, et seulement si l'obscurité au point est dans sa plage
 *   `data.darkness` (même test que `EffectsCanvasGroup#testInsideLight`, client/canvas/groups/effects.mjs:331-337 ; l'obscurité
 *   d'une région « Ajuster l'obscurité » comprise, `getDarknessLevel`, effects.mjs:383). Vive si `data.bright > 0` : une
 *   lumière globale « faible » a `bright: 0, dim: maxR` (client/canvas/groups/environment.mjs:320-331). Crépuscule (§16.52) :
 *   une lumière globale vive compte comme faible au-delà du seuil d'obscurité `twilightDarkness` du monde.
 * - Lumières : `canvas.effects.lightSources`, actives (ni éteintes ni supprimées par des ténèbres dont elles partent,
 *   sources/base-effect-source.mjs:160), hors aperçu ; `testPoint` pour la zone éclairée (polygone, murs, surfaces et hauteur
 *   compris, base-effect-source.mjs:365 ; une lumière magique, `priority > 0`, n'a pas de borne verticale,
 *   point-light-source.mjs:94-103). Lumière vive : à `data.bright` px du centre, en cylindre comme le test du cœur.
 * - Ténèbres : `canvas.effects.darknessSources`, actives, hors aperçu, `testPoint` (point-darkness-source.mjs:114) — même
 *   filtre que `testInsideDarkness` (effects.mjs:367-372).
 *
 * Les points sont des positions VALIDÉES (`_source`), jamais la position animée.
 */

import { committedPosition } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { convertLength } from "../core/units.mjs";
import { MODULE_ID } from "../constants.mjs";
import { globalLightLevel, lightLevel, perceivedLight, obscurement } from "../core/illumination.mjs";
import { devilsSightRange } from "./vision.mjs";

/**
 * Le niveau de lumière en un point de la scène affichée.
 * @param {{x: number, y: number, elevation?: number}} point
 * @returns {{level: number, darkened: boolean}|null}  null : canevas absent.
 */
export function lightAt(point) {
  if ( !canvas?.ready ) return null;
  const p = { x: point.x, y: point.y, elevation: point.elevation ?? 0 };
  const effects = canvas.effects;
  const globalSource = canvas.environment.globalLightSource;

  // Lumière globale, crépuscule compris (§16.52, réglage `twilightDarkness` : au-delà de ce seuil d'obscurité, vive → faible).
  const global = globalSource ? globalLightLevel(
    { active: globalSource.active, bright: globalSource.data.bright, darkness: globalSource.data.darkness },
    effects.getDarknessLevel(p), twilightThreshold()) : null;

  const lights = [];
  for ( const source of effects.lightSources ) {
    if ( (source === globalSource) || (source instanceof foundry.canvas.sources.GlobalLightSource) ) continue;
    if ( !source.active || source.isPreview || !source.testPoint(p) ) continue;
    lights.push({ priority: source.data.priority ?? 0, bright: inBright(source, p) });
  }

  const darkness = [];
  for ( const source of effects.darknessSources ) {
    if ( !source.active || source.isPreview || !source.testPoint(p) ) continue;
    darkness.push({ priority: source.data.priority ?? 0 });
  }

  return lightLevel({ global, lights, darkness });
}

/**
 * Le niveau que donne la lumière globale à l'obscurité de la scène affichée (pas en un point : sans les régions « Ajuster
 * l'obscurité »), crépuscule compris — pour un affichage de scène (§40.2).
 * @returns {number|null}  `LIGHT.BRIGHT`, `LIGHT.DIM`, ou null (pas de canevas, lumière globale inactive ou hors de sa plage).
 */
export function globalLight() {
  const source = canvas?.ready ? canvas.environment.globalLightSource : null;
  if ( !source ) return null;
  return globalLightLevel({ active: source.active, bright: source.data.bright, darkness: source.data.darkness },
    canvas.environment.darknessLevel, twilightThreshold());
}

/** Le seuil de crépuscule du monde (1 : jamais), réglage de runtime/illumination.mjs. */
function twilightThreshold() {
  try {
    const value = Number(game.settings.get(MODULE_ID, "twilightDarkness"));
    return Number.isFinite(value) ? value : 1;
  } catch { return 1; }
}

/** Dans le rayon de lumière vive de la source (px), en cylindre ; une lumière magique n'a pas de borne verticale. */
function inBright(source, p) {
  const r = source.data.bright ?? 0;
  if ( !(r > 0) ) return false;
  if ( !((source.data.priority ?? 0) > 0) ) {
    const dz = Math.abs(p.elevation - (source.data.elevation ?? 0)) * canvas.dimensions.distancePixels;
    if ( dz > r ) return false;
  }
  return Math.hypot(p.x - source.data.x, p.y - source.data.y) <= r;
}

/** Le centre d'un token à sa position validée, à hauteur de ses pieds. */
export function tokenPoint(doc) {
  const grid = doc.parent.grid;
  const p = committedPosition(doc);
  return { x: p.x + ((p.width ?? 1) * grid.sizeX) / 2, y: p.y + ((p.height ?? 1) * grid.sizeY) / 2, elevation: p.elevation ?? 0 };
}

/** Le niveau de lumière là où se tient ce token. */
export function lightOnToken(doc) {
  return doc?.parent ? lightAt(tokenPoint(doc)) : null;
}

/** Une portée de sens de la fiche (`senses.ranges`, dnd5e data/shared/senses-field.mjs:15), unité de la grille, ou 0. */
function senseRange(actor, key, grid) {
  const senses = actor?.system?.attributes?.senses;
  const value = Number(senses?.ranges?.[key]);
  if ( !(value > 0) ) return 0;
  try { return convertLength(value, senses.units ?? "ft", grid.units, readUnitFactors()); }
  catch { return value; }
}

/**
 * Les sens de l'observateur qui portent jusqu'au point : vision dans le noir, vision véritable, Vision du diable. Distance 3D
 * de la grille, depuis le centre de l'observateur (comme `canSeePoint`, adapter/vision.mjs).
 */
export function sensesToward(observer, point) {
  const grid = observer.parent.grid;
  const from = tokenPoint(observer);
  const distance = grid.measurePath([from, { x: point.x, y: point.y, elevation: point.elevation ?? from.elevation }]).distance;
  const reaches = range => (range > 0) && (distance <= range);
  return {
    darkvision: reaches(senseRange(observer.actor, "darkvision", grid)),
    truesight: reaches(senseRange(observer.actor, "truesight", grid)),
    devilsSight: reaches(devilsSightRange(observer))
  };
}

/**
 * Ce que l'observateur perçoit en ce point : niveau réel, niveau perçu, et ce qu'il impose (Désavantage en Perception en
 * zone légèrement obscurcie, Aveuglé pour y voir en zone fortement obscurcie).
 * @param {TokenDocument} observer
 * @param {{x: number, y: number, elevation?: number}} point
 * @returns {{level: number, darkened: boolean, perceived: number, obscured: string, perceptionDisadvantage: boolean,
 *            blinded: boolean}|null}  null : canevas absent.
 */
export function perceivedAt(observer, point) {
  const light = lightAt(point);
  if ( !light || !observer?.parent ) return null;
  const perceived = perceivedLight(light, sensesToward(observer, point));
  return { ...light, perceived, ...obscurement(perceived) };
}

/** Ce que l'observateur perçoit là où se tient la cible. */
export function perceivedOnToken(observer, target) {
  return target?.parent ? perceivedAt(observer, tokenPoint(target)) : null;
}

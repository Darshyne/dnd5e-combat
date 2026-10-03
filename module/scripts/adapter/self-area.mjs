/**
 * Une zone « sur soi », posée sur le lanceur sans clic (SPEC §47) — la région que dnd5e aurait créée si l'on avait cliqué
 * son token, construite comme `TemplatePlacement.fromActivity` (canvas/template-placement.mjs:86-189) :
 *  - émanation (type `radius`) : forme `emanation` à base `token` (template-placement.mjs:60-66), rattachée au token
 *    (`attachment.token`, sauf zone `stationary`), aux dimensions du token (template-placement.mjs:124-127) ;
 *  - sphère, cercle : forme `circle` au centre du token, non rattachée (dnd5e ne rattache que l'émanation) ;
 *  - mêmes flags `dnd5e` (activity, dimensions, item, origin, spellLevel), mêmes restriction, visibilité, niveau.
 * Les hooks du système sont émis comme il le fait (`dnd5e.createMeasuredTemplate` avant la création — la tranche
 * d'élévation du moteur y est posée, runtime/space.mjs —, `dnd5e.postCreateMeasuredTemplate` après) : qui les écoute voit
 * la même chose qu'avec la pose à la souris. Le reste (comportements de la région, résolution de zone, concentration) suit
 * `createRegion` comme d'habitude.
 */

import { selfAreaShape, aimedAreaShape, aimFrom, cubeBeside } from "../core/self-area.mjs";
import { convertLength } from "../core/units.mjs";
import { committedPosition, usageTokenOf } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";

/**
 * La forme et le token d'une zone à poser d'office, ou null (dnd5e pose comme d'habitude) : portée personnelle, zone
 * centrée (core/self-area.mjs), lanceur sur la scène affichée, droit de créer une région.
 * @param {Activity} activity
 * @returns {{shape: "emanation"|"circle", token: TokenDocument}|null}
 */
export function selfAreaOf(activity) {
  const template = activity?.target?.template;
  const shape = selfAreaShape({ rangeUnits: activity?.range?.units, type: template?.type, count: template?.count, size: template?.size });
  if ( !shape ) return null;
  const token = usageTokenOf(activity);
  if ( !token?.parent || (token.parent !== canvas?.scene) ) return null;
  if ( !game.user.can("REGION_CREATE") ) return null;
  return { shape, token };
}

/** Une longueur de l'activité, dans l'unité de la grille (undefined si absente). */
function toGrid(value, units, scene) {
  const n = Number(value);
  if ( !(n > 0) ) return undefined;
  try { return convertLength(n, units, scene.grid.units, readUnitFactors()); }
  catch { return n; }
}

/** Les dimensions de la zone de l'activité, dans l'unité de la grille. */
function dimensionsOf(activity, scene) {
  const target = activity.target.template;
  return {
    size: toGrid(target.size, target.units, scene),
    width: toGrid(target.width, target.units, scene),
    height: toGrid(target.height, target.units, scene)
  };
}

/**
 * Une région de zone d'activité, comme `TemplatePlacement.fromActivity` la construit (template-placement.mjs:136-171).
 * @param {Activity} activity
 * @param {TokenDocument} token   Le lanceur (origine).
 * @param {object} shapeData      La forme, en pixels.
 * @param {boolean} attached      Rattachée au lanceur (émanation non `stationary`).
 * @returns {object}
 */
function regionData(activity, token, shapeData, attached) {
  const scene = token.parent;
  const level = committedPosition(token).level ?? canvas.level?.id ?? null;
  return {
    name: `${activity.item.name} [${game.user.name}]`,
    color: game.user.color,
    shapes: [shapeData],
    ...(level ? { levels: [level] } : {}),
    restriction: { enabled: true, type: "move" },
    attachment: { token: attached ? token.id : undefined },
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: "coverage",
    flags: {
      dnd5e: {
        activity: activity.uuid,
        dimensions: { ...dimensionsOf(activity, scene), units: scene.grid.units },
        item: activity.item.uuid,
        origin: token.uuid,
        spellLevel: activity.getRollData().item?.level
      }
    }
  };
}

/** Crée les régions en émettant les hooks de dnd5e autour de la création, comme sa pose (template-placement.mjs:173-187). */
async function createAreaRegions(activity, token, data) {
  if ( Hooks.call("dnd5e.createMeasuredTemplate", activity, data) === false ) return null;
  const created = await token.parent.createEmbeddedDocuments("Region", data);
  Hooks.callAll("dnd5e.postCreateMeasuredTemplate", activity, created);
  return created;
}

/**
 * Les données de la région, comme dnd5e les construit.
 * @param {Activity} activity
 * @param {TokenDocument} token
 * @param {"emanation"|"circle"} shape
 * @returns {object}
 */
export function selfAreaRegionData(activity, token, shape) {
  const scene = token.parent;
  const radius = dimensionsOf(activity, scene).size * (scene.grid.size / scene.grid.distance);
  const pos = committedPosition(token);
  const attached = (shape === "emanation") && !activity.target.template.stationary;
  const shapeData = (shape === "emanation")
    ? { type: "emanation", radius,
      base: { type: "token", x: pos.x, y: pos.y, width: pos.width, height: pos.height, shape: pos.shape ?? token._source.shape } }
    : { type: "circle", radius,
      x: pos.x + ((pos.width * scene.grid.sizeX) / 2), y: pos.y + ((pos.height * scene.grid.sizeY) / 2) };
  return regionData(activity, token, shapeData, attached);
}

/**
 * Pose la zone sur le lanceur, en émettant les hooks de dnd5e autour de la création.
 * @param {Activity} activity
 * @param {{shape: "emanation"|"circle", token: TokenDocument}} area  Ce que `selfAreaOf` a rendu.
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeSelfArea(activity, { shape, token }) {
  return createAreaRegions(activity, token, [selfAreaRegionData(activity, token, shape)]);
}

/* -------------------------------------------- */
/*  Cônes et lignes visés depuis le lanceur     */
/* -------------------------------------------- */

/**
 * Le cône, la ligne ou le cube à viser autour du lanceur (SPEC §59), ou null (pose de dnd5e) : portée personnelle, une zone
 * (core/self-area.mjs), lanceur sur la scène affichée, droit de créer une région.
 * @param {Activity} activity
 * @returns {{shape: "cone"|"line"|"cube", token: TokenDocument}|null}
 */
export function aimedAreaOf(activity) {
  const template = activity?.target?.template;
  const shape = aimedAreaShape({ rangeUnits: activity?.range?.units, type: template?.type, count: template?.count, size: template?.size });
  if ( !shape ) return null;
  const token = usageTokenOf(activity);
  if ( !token?.parent || (token.parent !== canvas?.scene) ) return null;
  if ( !game.user.can("REGION_CREATE") ) return null;
  return { shape, token };
}

/**
 * La forme visée vers ce point : sommet sur le bord de l'espace du lanceur, pivot en son centre (`aimFrom`) ; un cube, accolé
 * au lanceur du côté visé (`cubeBeside`).
 * Dimensions comme `TemplatePlacement#createShapeData` (template-placement.mjs:52-71) : angle du cône par défaut du cœur,
 * largeur de la ligne lue sur l'activité (une case si elle n'en dit rien).
 * @param {Activity} activity
 * @param {{shape: "cone"|"line"|"cube", token: TokenDocument}} area
 * @param {{x: number, y: number}} point         Point visé, en pixels.
 * @param {{x: number, y: number}|null} [fallback]  Direction si le point est au centre du lanceur.
 * @returns {object}  Données de forme de région.
 */
export function aimedShapeData(activity, { shape, token }, point, fallback=null) {
  const scene = token.parent;
  const perUnit = scene.grid.size / scene.grid.distance;
  const pos = committedPosition(token);
  const body = { x: pos.x, y: pos.y, width: pos.width * scene.grid.sizeX, height: pos.height * scene.grid.sizeY };
  const ellipse = [CONST.TOKEN_SHAPES.ELLIPSE_1, CONST.TOKEN_SHAPES.ELLIPSE_2].includes(pos.shape ?? token._source.shape);
  const { size, width } = dimensionsOf(activity, scene);
  if ( shape === "cube" ) {
    const side = size * perUnit;
    const step = scene.grid.type === CONST.GRID_TYPES.GRIDLESS ? 0 : scene.grid.size;
    return { type: "rectangle", ...cubeBeside(body, point, side, { step, fallback }), width: side, height: side, rotation: 0 };
  }
  const { x, y, rotation } = aimFrom(body, point, { ellipse, fallback });
  if ( shape === "cone" ) return { type: "cone", x, y, rotation, radius: size * perUnit, angle: CONFIG.MeasuredTemplate.defaults.angle };
  return { type: "line", x, y, rotation, length: size * perUnit, width: (width ?? scene.grid.distance) * perUnit };
}

/**
 * Les données de la région visée (aperçu de la visée, puis création).
 * @param {Activity} activity
 * @param {{shape: "cone"|"line"|"cube", token: TokenDocument}} area
 * @param {object} shapeData  `aimedShapeData`.
 * @returns {object}
 */
export function aimedRegionData(activity, { token }, shapeData) {
  return regionData(activity, token, shapeData, false);
}

/**
 * Pose la zone visée, en émettant les hooks de dnd5e autour de la création.
 * @param {Activity} activity
 * @param {{shape: "cone"|"line"|"cube", token: TokenDocument}} area
 * @param {object} shapeData
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeAimedArea(activity, area, shapeData) {
  return createAreaRegions(activity, area.token, [aimedRegionData(activity, area, shapeData)]);
}

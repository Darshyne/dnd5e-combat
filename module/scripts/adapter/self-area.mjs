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

import { MODULE_ID } from "../constants.mjs";
import { selfAreaShape, aimedAreaShape, aimFrom, cubeBeside } from "../core/self-area.mjs";
import { committedPosition, usageTokenOf, tokenCenter } from "./turn.mjs";
import { templateOf } from "./template.mjs";
import { contentOf } from "./content.mjs";
import { clampPolyline, wallLineShapes, orthogonalize, cellWallShapes } from "../core/wall.mjs";
import { lengthIn } from "./units.mjs";
import { carriedLightOf } from "./carried-lights.mjs";
import { clearPathTo } from "./cover.mjs";
import { contiguousRects, rectOfShape } from "../core/space.mjs";

/**
 * La forme et le token d'une zone à poser d'office, ou null (dnd5e pose comme d'habitude) : portée personnelle, zone
 * centrée (core/self-area.mjs), lanceur sur la scène affichée, droit de créer une région.
 * @param {Activity} activity
 * @returns {{shape: "emanation"|"circle", token: TokenDocument}|null}
 */
export function selfAreaOf(activity) {
  // §254 : le rayon d'une source de lumière portée (lanterne à capote : « Light », 60 pi sur soi) est sa lumière, que le moteur pose
  // sur le token (§121) — pas une zone : la région suivait le porteur partout.
  if ( carriedLightOf(activity?.item) ) return null;
  const template = templateOf(activity);   // §86 : ou celui que le contenu fournit
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
  return lengthIn(n, units, scene.grid.units);
}

/** Les dimensions de la zone de l'activité, dans l'unité de la grille. */
function dimensionsOf(activity, scene) {
  const target = templateOf(activity) ?? {};
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
      },
      // §190 : posée par le moteur (cône visé, zone sur soi, bille de Boule de feu à retardement), pas par la pose de dnd5e — la
      // vérification de portée (ui/pointer.mjs) ne s'y applique pas.
      [MODULE_ID]: { enginePlaced: true }
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
  const attached = (shape === "emanation") && !templateOf(activity)?.stationary;
  const shapeData = (shape === "emanation")
    ? { type: "emanation", radius,
      base: { type: "token", x: pos.x, y: pos.y, width: pos.width, height: pos.height, shape: pos.shape ?? token._source.shape } }
    : { type: "circle", radius,
      x: pos.x + ((pos.width * scene.grid.sizeX) / 2), y: pos.y + ((pos.height * scene.grid.sizeY) / 2) };
  return regionData(activity, token, shapeData, attached);
}

/**
 * §91 : pose la zone de l'activité (sphère, cercle) centrée sur un point, sans clic — la bille de la Boule de feu à retardement qui
 * explose là où elle est. Mêmes données et mêmes hooks que la pose de dnd5e.
 * @param {Activity} activity
 * @param {TokenDocument} token      Le lanceur (origine).
 * @param {{x: number, y: number}} point
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeAreaAt(activity, token, point) {
  const scene = token.parent;
  const radius = dimensionsOf(activity, scene).size * (scene.grid.size / scene.grid.distance);
  return createAreaRegions(activity, token, [regionData(activity, token, { type: "circle", radius, x: point.x, y: point.y }, false)]);
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
/*  Zones lancées à distance (§190)             */
/* -------------------------------------------- */

/** Les unités de portée qui sont des longueurs (pas « personnelle », « contact », « illimitée »…). */
const LENGTH_UNITS = new Set(["ft", "m", "km", "mi"]);

/**
 * §190 : une sphère, un cylindre, un cube ou un carré lancé « en un point à portée » (Aspersion d'acide, Boule de feu) — ce qu'il faut
 * pour le poser à la souris avec sa portée : `{ token, shape: "circle"|"rectangle", side (px : rayon ou côté), range (unités de la
 * grille), max, units, count, contiguous }`, ou null (portée personnelle ou au contact, lanceur absent de la scène
 * affichée). Formes et dimensions comme `TemplatePlacement#createShapeData` (template-placement.mjs:52-71).
 * @param {Activity} activity
 */
export function rangedAreaOf(activity) {
  const template = activity?.target?.template;
  const kind = CONFIG.DND5E?.areaTargetTypes?.[template?.type]?.template;
  if ( !["circle", "rect", "rectangle"].includes(kind) ) return null;
  // §286 : plusieurs gabarits (Nuée de météores, Tempête de feu) — chacun à portée ; `contiguous` : des cubes qui se touchent.
  const count = Math.max(1, Number(template.count) || 1);
  const value = Number(activity.range?.value);
  if ( !(value > 0) || !LENGTH_UNITS.has(activity.range?.units) ) return null;
  const token = usageTokenOf(activity);
  if ( !token?.parent || (token.parent !== canvas?.scene) ) return null;
  if ( !game.user.can("REGION_CREATE") ) return null;
  const scene = token.parent;
  const { size } = dimensionsOf(activity, scene);
  if ( !(size > 0) ) return null;
  return { token, shape: (kind === "circle") ? "circle" : "rectangle", side: size * (scene.grid.size / scene.grid.distance),
    range: lengthIn(value, activity.range.units, scene.grid.units), max: value, units: activity.range.units,
    count, contiguous: (count > 1) && (template.contiguous === true) };
}


/** §190 : le centre d'une forme posée — §200 : son point d'origine. */
export function rangedCenter(shapeData) {
  if ( shapeData.type === "rectangle" ) return { x: shapeData.x + (shapeData.width / 2), y: shapeData.y + (shapeData.height / 2) };
  return { x: shapeData.x, y: shapeData.y };
}

/**
 * §190 : la forme est-elle hors de portée ? Distance du bord de l'espace du lanceur (son centre, moins sa demi-largeur) au point
 * d'origine — le centre d'une sphère, d'un cylindre ; pour un cube, une face (le centre, moins la moitié du côté).
 */
export function rangedTooFar(area, shapeData) {
  const grid = area.token.parent.grid;
  const from = tokenCenter(area.token);
  const distance = grid.measurePath([{ x: from.x, y: from.y }, rangedCenter(shapeData)]).distance;
  const body = ((committedPosition(area.token).width || 1) * grid.distance) / 2;
  const slack = (shapeData.type === "rectangle") ? (area.side / 2) * (grid.distance / grid.size) : 0;
  return (distance - body) > (area.range + slack + 1e-6);
}

/**
 * Ce qui refuse la pose de ces formes (`rangedAreaOf`) : `"far"` (§190, une forme hors de portée), `"hidden"` (§200, pas de chemin
 * dégagé jusqu'à son point), `"apart"` (§286, des cubes `contiguous` qui ne se touchent pas : Tempête de feu), ou null.
 * @param {object} area  `rangedAreaOf`.
 * @param {object[]} shapes  Les formes des régions à créer.
 */
export function rangedPlacementProblem(area, shapes) {
  if ( shapes.some(shape => rangedTooFar(area, shape)) ) return "far";
  if ( shapes.some(shape => clearPathTo(area.token, rangedCenter(shape)) === false) ) return "hidden";
  if ( area.contiguous && !contiguousRects(shapes.map(rectOfShape).filter(r => r)) ) return "apart";
  return null;
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
  // §254 : de même le cône d'une lanterne sourde.
  if ( carriedLightOf(activity?.item) ) return null;
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

/* -------------------------------------------- */
/*  Murs posés par points (§162)                */
/* -------------------------------------------- */

/**
 * §162 : un sort à gabarit « wall » (Mur de feu, Mur de force en panneaux, Barrière de lames…) se pose par points : la ligne brisée
 * qu'ils dessinent, au plus la longueur totale du sort (la taille du gabarit, fois le nombre de panneaux), de son épaisseur. Rend
 * ce qu'il faut à la visée (longueur et épaisseur en pixels), ou null : pas un mur, lanceur absent de la scène affichée, pas le
 * droit de créer une région.
 * @param {Activity} activity
 * @returns {{shape: "wall", token: TokenDocument, length: number, width: number, orthogonal: boolean, cells: boolean, half: number,
 *   lineLength: number}|null}
 */
export function wallAreaOf(activity) {
  const template = activity?.target?.template;
  if ( template?.type !== "wall" ) return null;
  // Portails et portes (Portail arcanique, Portail, Demi-plan, Manoir) : pas des murs.
  if ( contentOf(activity.item).entry?.pointWall === false ) return null;
  const token = usageTokenOf(activity);
  if ( !token?.parent || (token.parent !== canvas?.scene) ) return null;
  if ( !game.user.can("REGION_CREATE") ) return null;
  const scene = token.parent;
  const perUnit = scene.grid.size / scene.grid.distance;
  const { size, width } = dimensionsOf(activity, scene);
  const count = Math.max(1, Number(template.count) || 1);
  // §169 : un mur à face brûlante (Mur de feu) se pose sans diagonale ; §172 : un mur épais (Mur d'épines, Barrière de lames), sur
  // une rangée de cases — points au centre des cases, la ligne de centres plus courte d'une case que le mur.
  const entry = contentOf(activity.item).entry;
  const cells = entry?.cellWall === true;
  const length = (size || 0) * count * perUnit;
  return { shape: "wall", token, length, width: Math.max(1, (width || 1) * perUnit), orthogonal: cells || !!entry?.wallSide || (entry?.thinWall === true),
    cells, half: scene.grid.size / 2, lineLength: cells ? Math.max(0, length - scene.grid.size) : length };
}

/**
 * Pose le mur le long des points, en émettant les hooks de dnd5e autour de la création : une région, une forme « line » par segment.
 * @param {Activity} activity
 * @param {{token: TokenDocument, length: number, width: number}} area  `wallAreaOf`.
 * @param {Array<{x: number, y: number}>} points
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeWallArea(activity, area, points) {
  const shapes = area.cells ? cellWallShapes(points, area.length || Infinity, area.width, area.half)
    : wallLineShapes(clampPolyline(area.orthogonal ? orthogonalize(points) : points, area.length || Infinity), area.width);
  if ( !shapes.length ) return Promise.resolve(null);
  return createAreaRegions(activity, area.token, [{ ...regionData(activity, area.token, shapes[0], false), shapes }]);
}

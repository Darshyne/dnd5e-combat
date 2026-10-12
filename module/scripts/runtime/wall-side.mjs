/**
 * §169 : le mur à face brûlante (adapter/wall-side.mjs) — à sa pose, son côté (à l'opposé du lanceur) et, pour un anneau, le disque de
 * dnd5e changé en anneau fin ; dès que la zone est retenue (son message d'utilisation), la face brûlante : une seconde région, rejouée
 * en fin de tour, sans sauvegarde ; retournée sur demande du lanceur (menu de son token) ; retirée avec le mur. MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { readAreaState } from "../adapter/areas.mjs";
import { wallSideRuleOf, wallGeometryOf, sideDepthOf, sideRegionOf } from "../adapter/wall-side.mjs";
import { defaultSide, sideShapes, ringShapes } from "../core/wall.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { enqueue } from "./queue.mjs";

export const FLIP_WALL_QUERY = `${MODULE_ID}.flipWallSide`;

/** Le centre du lanceur qui a posé la région, ou null. */
function casterCenter(region) {
  const token = fromUuidSync(region.getFlag("dnd5e", "origin") ?? "", { strict: false });
  const object = token?.object;
  return object ? object.center : null;
}

/** À la pose : le côté brûlant (sauf s'il est déjà choisi, §171), et l'anneau fin à la place du disque. */
function onCreate(region) {
  if ( !wallSideRuleOf(region) ) return;
  return enqueue(`wallSide:${region.id}`, () => setUp(region));
}

async function setUp(region) {
  const geometry = wallGeometryOf(region);
  if ( !geometry ) return;
  const side = region.getFlag(MODULE_ID, "wallSide")?.side ?? defaultSide(geometry, casterCenter(region));
  const update = { [`flags.${MODULE_ID}.wallSide`]: { side } };
  // Le disque d'un gabarit « cylinder » (Manuel des joueurs) devient un anneau fin ; un gabarit « ring » (dnd5e) l'est déjà.
  if ( geometry.ring && !region.shapes.some(s => s.type === "ring") ) {
    const scene = region.parent;
    const width = (Number(region.getFlag("dnd5e", "dimensions")?.width) || 1) * (scene.grid.size / scene.grid.distance);
    update.shapes = ringShapes(geometry.ring, width);
  }
  await region.update(update);
  log(`area "${region.name}": burning side ${side > 0 ? (geometry.ring ? "inside" : "left") : (geometry.ring ? "outside" : "right")}`);
}

/** Les données de la face brûlante d'un mur. */
function sideData(wall, side) {
  const rule = wallSideRuleOf(wall);
  const state = readAreaState(wall);
  const shapes = sideShapes(wallGeometryOf(wall), side, sideDepthOf(wall.parent, rule));
  const source = wall.toObject();
  return {
    name: `${wall.name} — ${loc("MurFace.Nom")}`,
    color: "#ff5a1f",
    shapes,
    levels: source.levels ?? [],
    elevation: source.elevation,
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: "coverage",
    flags: {
      [MODULE_ID]: {
        sideOf: wall.id,
        // Rejouée en fin de tour seulement : qui y finit son tour subit les dégâts (sans sauvegarde : runtime/areas.mjs).
        area: { on: ["turnEnd"], turnKey: state.turnKey, hit: [], usage: state.usage, activity: state.activity ?? null,
          exclude: state.exclude ?? null, source: state.source ?? null, affects: state.affects ?? "", originDisposition: state.originDisposition ?? null }
      }
    }
  };
}

/** Dès que la zone est retenue : sa face brûlante. */
function onUpdate(region, changes) {
  if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || !wallSideRuleOf(region) ) return;
  return enqueue(`wallSide:${region.id}`, async () => {
    const side = region.getFlag(MODULE_ID, "wallSide")?.side;
    if ( !side || !readAreaState(region)?.usage || sideRegionOf(region) ) return;
    const [created] = await region.parent.createEmbeddedDocuments("Region", [sideData(region, side)]);
    if ( created ) log(`area "${region.name}": burning side placed (${created.shapes.length} shape(s))`);
  });
}

/** Le mur parti, sa face brûlante aussi. */
async function onDelete(region) {
  const side = region.parent?.regions.find(r => r.getFlag(MODULE_ID, "sideOf") === region.id);
  if ( side ) await side.delete();
}

/**
 * Côté MJ actif : retourner la face brûlante, ou la mettre d'un côté donné (`side` : +1 à gauche du tracé ou à l'intérieur de l'anneau,
 * -1 de l'autre côté). À la file avec la pose de la face : un choix fait pendant qu'elle se pose ne se perd pas.
 */
export function handleFlipWallSide({ region: uuid, side: wanted=null }) {
  const wall = fromUuidSync(uuid, { strict: false });
  if ( !wall || !wallSideRuleOf(wall) ) return false;
  return enqueue(`wallSide:${wall.id}`, async () => {
    const current = wall.getFlag(MODULE_ID, "wallSide")?.side ?? 1;
    const side = [1, -1].includes(wanted) ? wanted : -current;
    if ( side === current ) return true;
    await wall.setFlag(MODULE_ID, "wallSide", { side });
    const burning = sideRegionOf(wall);
    if ( burning ) await burning.update({ shapes: sideShapes(wallGeometryOf(wall), side, sideDepthOf(wall.parent, wallSideRuleOf(wall))) });
    log(`area "${wall.name}": burning side ${wanted ? "set" : "flipped"}`);
    return true;
  });
}

/** Intention « retourner la face brûlante de ce mur » ou « la mettre de ce côté » (le client qui agit ; le MJ actif écrit). */
export async function flipWallSide(wall, side=null) {
  const gm = game.users.activeGM;
  if ( !gm ) { ui.notifications.warn(loc("Zone.SansMJ")); return false; }
  const payload = { region: wall.uuid, ...(side ? { side } : {}) };
  const done = gm.isSelf ? await handleFlipWallSide(payload)
    : await gm.query(FLIP_WALL_QUERY, payload, { timeout: 10000 }).catch(err => { console.warn(`${MODULE_ID} | wall side`, err); return false; });
  if ( done && !side ) ui.notifications.info(loc("MurFace.Retournee", { item: wall.name.replace(/\s*\[.*\]$/, "") }));
  return done;
}

export function registerWallSide() {
  CONFIG.queries[FLIP_WALL_QUERY] = handleFlipWallSide;
  route("createRegion", onCreate, { executor: true, label: "wall: burning side not chosen" });
  route("updateRegion", onUpdate, { executor: true, label: "wall: burning side not placed" });
  route("deleteRegion", onDelete, { executor: true, label: "wall: burning side not removed" });
}

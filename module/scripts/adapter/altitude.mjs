/**
 * Le sol sous un token, et ce qu'une créature peut faire de ses modes de déplacement (SPEC §17.4).
 *
 * Vérifié :
 *  - le sol d'une scène V14 est une **Surface** qui arrête le déplacement : `Scene#getSurfaces({ type: "move", level })`
 *    (client/documents/scene.mjs:793), rangées par élévation croissante, chacune avec `elevation` et `region`. dnd5e 6.0.3
 *    cherche de la même façon la surface qui porte un token (`TokenDocument5e#_findSupportingSurface`,
 *    documents/token.mjs:294 — interne, donc relu ici et non appelé) et, faute de surface sur la scène, prend la base du
 *    niveau (`level.elevation.base`)
 *  - un niveau a une tranche `elevation.bottom`/`top` (null = infini) : seule une surface de cette tranche est le sol de
 *    ce niveau — le plancher de l'étage du dessus peut être listé dans le niveau du dessous (Restored Keep, §14.2)
 *  - les vitesses préparées sont dans `system.attributes.movement.speeds` (data/actor/templates/attributes.mjs:535), déjà
 *    ramenées à 0 par À terre, Agrippé, Entravé…
 */

import { MODULE_ID } from "../constants.mjs";
import { placementOf, modeRefusal, speedFor } from "../core/altitude.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors } from "./units.mjs";
import { committedPosition, positionOf } from "./turn.mjs";

const rangeOf = level => ({ bottom: level?.elevation?.bottom ?? -Infinity, top: level?.elevation?.top ?? Infinity });

/**
 * L'élévation du sol d'un niveau en un point de la scène : la plus haute surface `move` de sa tranche qui contient le
 * point ; à défaut, une surface plus bas que le niveau (la cour vue de l'étage : pas de plancher d'étage au-dessus
 * d'elle, son sol est celui du rez-de-chaussée) ; sinon la base du niveau initial de la scène s'il est plus bas, ou celle
 * du niveau (0 sans niveau). Sans aucune surface sur la
 * scène, chaque niveau est un étage dont la base est le sol, comme le suppose dnd5e (documents/token.mjs:330).
 * @param {Scene} scene
 * @param {string|null} levelId
 * @param {{x: number, y: number}} point
 */
export function groundAt(scene, levelId, point) {
  const level = (levelId && scene.levels?.get?.(levelId)) || null;
  const { bottom, top } = rangeOf(level);
  const covers = surface => surface.region?.polygonTree?.testPoint(point);
  const own = scene.getSurfaces?.({ type: "move", ...(level ? { level: level.id } : {}) }) ?? [];
  for ( let n = own.length; n--; ) {
    const surface = own[n];
    if ( (surface.elevation >= bottom) && (surface.elevation < top) && covers(surface) ) return surface.elevation;
  }
  const all = scene.getSurfaces?.({ type: "move" }) ?? [];
  if ( Number.isFinite(bottom) ) {
    for ( let n = all.length; n--; ) if ( (all[n].elevation < bottom) && covers(all[n]) ) return all[n].elevation;
  }
  // Aucun plancher sous le point, sur une scène qui en a : au-dessus du vide à l'étage, le sol est celui du niveau initial
  // de la scène (le rez-de-chaussée), pas la base de l'étage — vu en jeu le 2026-09-26 : descendu depuis l'étage au-dessus
  // de la cour, le token « passait sous le sol » à 15 ft.
  const base = level?.elevation?.base ?? 0;
  const initial = all.length ? scene.initialLevel?.elevation?.base : undefined;
  return (Number.isFinite(initial) && (initial < base)) ? initial : base;
}

/**
 * Le niveau d'une élévation : celui dont la tranche `[bas, haut[` la contient. Le niveau actuel s'il la contient encore,
 * s'il n'y en a aucun ou s'il y en a plusieurs (même règle que dnd5e à l'arrivée d'une chute, documents/token.mjs:355).
 * Le cœur V14 ne change jamais le niveau d'un token d'après son élévation : seul un escalier (`changeLevel`) le fait.
 * @param {Scene} scene
 * @param {number} elevation
 * @param {string} currentId
 * @returns {string}
 */
export function levelAt(scene, elevation, currentId) {
  const contains = level => { const { bottom, top } = rangeOf(level); return (elevation >= bottom) && (elevation < top); };
  const current = scene.levels?.get?.(currentId);
  if ( !scene.levels?.size || (current && contains(current)) ) return currentId;
  const homes = scene.levels.filter(contains);
  return (homes.length === 1) ? homes[0].id : currentId;
}

/** Le centre d'un token à une position (source ou point de passage). */
function centerAt(token, pos) {
  const grid = token.parent.grid;
  return { x: pos.x + (((pos.width ?? token._source.width ?? 1) * grid.sizeX) / 2), y: pos.y + (((pos.height ?? token._source.height ?? 1) * grid.sizeY) / 2) };
}

/** Le sol sous un token, à sa position validée ou à `pos`. */
export function groundUnder(token, pos=committedPosition(token)) {
  return groundAt(token.parent, pos.level ?? token._source.level, centerAt(token, pos));
}

/**
 * Le plafond en un point, vu d'un sol donné : la plus basse surface `move` au-dessus de ce sol qui contient le point,
 * **quel que soit le niveau auquel elle est rattachée**. Infinity : rien. Le haut du niveau n'est pas un plafond : sans
 * surface, on monte dans le niveau du dessus (`levelAt`).
 * Vu en jeu le 2026-09-26 (« Magicien des vins ») : un token qui vole les pieds SUR une surface ne peut plus redescendre —
 * le cœur la tient pour pleine en dessous quand le rayon part d'elle (`side: "below"`, scene.mjs:810). Et le cœur ne
 * teste que les surfaces du niveau du token : le plancher de l'étage, rattaché à l'étage seul, laissait monter à travers
 * lui depuis le rez-de-chaussée. Un plancher arrête un vol d'où qu'il vienne.
 * Le cœur arrête un token dès qu'une partie de lui passe sous un plancher (rayons des pieds, du centre et de la tête,
 * placeables/token.mjs:3222-3232) : au bord d'un bâtiment, le centre seul ne suffit pas — on teste les points de contrôle
 * du token (`TokenDocument#getContainmentTestPoints`, documents/token.mjs:3348), et un seul sous le plancher suffit.
 * @param {Scene} scene
 * @param {{x: number, y: number}|{x: number, y: number}[]} points
 * @param {number} ground
 */
export function ceilingAt(scene, points, ground) {
  const list = Array.isArray(points) ? points : [points];
  for ( const surface of scene.getSurfaces?.({ type: "move" }) ?? [] ) {   // rangées par élévation croissante
    if ( !Number.isFinite(surface.elevation) || (surface.elevation <= ground + 1e-6) ) continue;
    if ( list.some(p => surface.region?.polygonTree?.testPoint(p)) ) return surface.elevation;
  }
  return Infinity;
}

/**
 * Où un token peut se tenir à une position : `ground` (sol) et `ceiling` (élévation la plus haute pour ses pieds en vol :
 * plafond moins sa hauteur, `depth` du cœur V14 en cases).
 */
export function boundsUnder(token, pos=committedPosition(token)) {
  const scene = token.parent;
  const levelId = pos.level ?? token._source.level;
  const point = centerAt(token, pos);
  const ground = groundAt(scene, levelId, point);
  const height = (positionOf({ ...token._source, ...pos }).depth ?? 1) * scene.grid.distance;
  let points = [point];
  try { points = [point, ...token.getContainmentTestPoints({ ...token._source, ...pos })]; }
  catch { /* API absente : le centre */ }
  return { ground, ceiling: ceilingAt(scene, points, ground) - height };
}

/** 5 ft (règle : écart minimal au sol en vol ou en fouissement, et hauteur d'une marche), dans l'unité de la scène. */
export function clearanceOf(scene) {
  try { return convertLength(5, "ft", scene.grid.units, readUnitFactors()); }
  catch { return scene.grid.distance; }
}

export const speedsOf = actor => actor?.system?.attributes?.movement?.speeds ?? actor?.system?.attributes?.movement ?? {};

/** Pourquoi cette créature ne peut pas prendre ce mode, ou null. */
export const modeRefusalFor = (actor, action) => modeRefusal(action, speedsOf(actor));

/* -------------------------------------------- */
/*  Vitesse accordée par le choix du mode       */
/* -------------------------------------------- */

/**
 * Les effets que le moteur a posés pour accorder une vitesse (flag `grantedSpeed` = la vitesse : `fly`, `burrow`).
 * @param {Actor5e} actor
 */
export const grantedSpeedEffects = actor => (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "grantedSpeed"));

/**
 * Choisir un mode dans le HUD du token vaut décision du MJ ou du joueur : une créature qui n'en a pas la vitesse la
 * reçoit, égale à sa vitesse de marche (30 ft si elle n'en a pas), par un effet qui porte le nom du mode. Même forme de
 * changement que les capacités de dnd5e qui donnent un vol (Ailes draconiques : `system.attributes.movement.fly`,
 * `upgrade`, packs/_source/classes24/sorcerer/…/dragon-wings.yml:159).
 * @param {TokenDocument} token
 * @param {string} action  Le mode choisi.
 * @returns {Promise<boolean>}  true si un effet a été posé.
 */
export async function grantSpeedFor(token, action) {
  const speed = speedFor(action);
  const actor = token.actor;
  if ( !speed || !actor || !modeRefusalFor(actor, action) ) return false;
  const walk = Number(speedsOf(actor).walk) || Number(actor.system?.attributes?.movement?.walk) || 30;
  const config = CONFIG.Token.movement.actions[action] ?? {};
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format("DND5ECOMBAT.Altitude.VitesseAccordee", { mode: game.i18n.localize(config.label ?? action) }),
    img: config.img ?? "icons/svg/wing.svg",
    system: { changes: [{ key: `system.attributes.movement.${speed}`, value: String(walk), type: "upgrade", phase: "initial" }] },
    flags: { [MODULE_ID]: { grantedSpeed: speed } }
  }]);
  return true;
}

/**
 * Retire les vitesses accordées qui ne servent plus au mode `action` (retour à la marche : le vol accordé tombe).
 * @returns {Promise<number>}  Nombre d'effets retirés.
 */
export async function revokeSpeedsBut(token, action) {
  const keep = speedFor(action);
  const ids = grantedSpeedEffects(token.actor).filter(e => e.getFlag(MODULE_ID, "grantedSpeed") !== keep).map(e => e.id);
  if ( ids.length ) await token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

/** Le mode au sol d'une créature : ramper si elle ne peut que ramper (À terre), sinon marcher. */
export const groundModeOf = actor => (actor?.hasConditionEffect?.("crawl") ? "crawl" : "walk");

/**
 * Le mode dans lequel le token se déplace vraiment : le sien, sauf un mode au sol nettement en l'air (ou sous terre) —
 * une créature qui vole (ou fouit) dont personne n'a changé le mode ; si elle en a la vitesse, c'est ce mode-là.
 * @param {TokenDocument} token
 * @param {object} [pos]  Position (point de départ d'un déplacement), sinon la position validée.
 */
export function effectiveMode(token, pos=committedPosition(token)) {
  const mode = token.movementAction;
  if ( placementOf(mode) !== "ground" ) return mode;
  const ground = groundUnder(token, pos);
  const step = clearanceOf(token.parent);
  const elevation = pos.elevation ?? 0;
  const to = (elevation > ground + step + 1e-6) ? "fly" : ((elevation < ground - step - 1e-6) ? "burrow" : null);
  return (to && !modeRefusalFor(token.actor, to)) ? to : mode;
}

/** Le token est-il en l'air (en vol, ou au-dessus de son sol) ? */
export function isAirborne(token) {
  if ( placementOf(token.movementAction) === "air" ) return true;
  return (token._source.elevation ?? 0) > groundUnder(token) + 1e-6;
}

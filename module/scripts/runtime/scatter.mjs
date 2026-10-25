/**
 * §187 : les objets qu'on répand au sol — Chausse-trapes, Billes (Manuel des joueurs 2024, `scatter` dans content/gear.mjs). Leur
 * activité n'a pas de durée, mais leur zone reste (runtime/engine-areas.mjs) et n'agit que sur qui y entre (runtime/areas.mjs, rejeu
 * `enter`). Ici :
 *  - qui y entre s'arrête sur sa première case (`scatterStop`, appelé par `preMoveToken`) : la sauvegarde se joue là, puis il
 *    repart s'il le peut — Vitesse 0 (chausse-trapes) ou À terre (billes) sur un échec ;
 *  - l'image de l'objet sur la zone (une tuile, retirée avec elle) ;
 *  - le ramassage, hors combat : « il faut 10 minutes pour les récupérer » — l'horloge avance de 10 minutes, l'objet revient dans
 *    l'inventaire de qui ramasse (une utilisation rendue, sinon un de plus, sinon une copie de l'objet répandu).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { readAreaState, lastingRegions, isInside } from "../adapter/areas.mjs";
import { positionOf, committedPosition } from "../adapter/turn.mjs";
import { continuedFlags, walkOptions } from "../adapter/movement.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { firstEntry, shouldTrigger, turnKeyOf } from "../core/area.mjs";
import { route } from "./router.mjs";
import { levelAtLeast } from "./levels.mjs";
import { log, loc, viaActiveGM } from "./shared.mjs";

export const PICKUP_QUERY = `${MODULE_ID}.pickUp`;
/** « Il faut 10 minutes pour les récupérer. » */
const RECOVER_SECONDS = 600;

const currentTurnKey = () => turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);

/** L'activité pose-t-elle un objet répandu ? */
export function scatterOf(activity) {
  return contentOf(activity?.item).entry?.scatter === true;
}

/** Les zones d'objets répandus de cette scène. */
export function scatterZones(scene) {
  return lastingRegions(scene).filter(r => readAreaState(r)?.scatter);
}

/* -------------------------------------------- */
/*  Pose                                        */
/* -------------------------------------------- */

/** Le rectangle qui contient les formes d'une région (pixels). */
function boundsOf(region) {
  const xs = [];
  const ys = [];
  for ( const shape of region._source.shapes ?? [] ) {
    if ( Array.isArray(shape.points) ) shape.points.forEach((v, i) => (i % 2 ? ys : xs).push(v));
    else if ( Number.isFinite(shape.width) ) { xs.push(shape.x, shape.x + shape.width); ys.push(shape.y, shape.y + shape.height); }
  }
  if ( !xs.length ) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** §187, §188 : l'image d'un objet posé au sol (chausse-trapes, flaque d'huile), une tuile sur la zone, retirée avec elle. MJ actif. */
export async function groundTile(region, img) {
  const box = boundsOf(region);
  if ( !box || !img ) return null;
  const [tile] = await region.parent.createEmbeddedDocuments("Tile", [{
    ...box, texture: { src: img }, alpha: 0.9, elevation: Number.isFinite(region.elevation?.bottom) ? region.elevation.bottom : 0,
    flags: { [MODULE_ID]: { ground: region.id } }
  }]).catch(err => { console.warn(`${MODULE_ID} | ground item: no tile`, err); return []; });
  return tile ?? null;
}

/**
 * Ce que la zone garde de l'objet répandu : sa copie (l'objet a pu disparaître, chausse-trapes « autoDestroy »), prise au moment de
 * l'utilisation sur le message, et la tuile qui le montre au sol. MJ actif (pose de la zone).
 */
export async function scatterState(region, message, activity) {
  const item = message?.getFlag(MODULE_ID, "scatterItem") ?? activity?.item?.toObject?.() ?? null;
  const tile = await groundTile(region, item?.img);
  log(`${item?.name ?? region.name}: scattered on the ground, stays until picked up`);
  return { item, tile: tile?.id ?? null };
}

/* -------------------------------------------- */
/*  Entrer dans la zone                         */
/* -------------------------------------------- */

/**
 * Le trajet case par case : un glisser du cœur n'a que ses points posés (départ, arrivée), l'A* du moteur une case par point. Chaque
 * segment est découpé par la grille (`getDirectPath`, common/grid/base.mjs:490), sur le centre de la case du coin haut-gauche.
 */
function cellSteps(token, path) {
  const grid = token.parent.grid;
  if ( grid.isGridless || (path.length < 2) ) return path;
  const half = p => ({ x: p.x + (grid.sizeX / 2), y: p.y + (grid.sizeY / 2) });
  const out = [path[0]];
  for ( let n = 1; n < path.length; n++ ) {
    for ( const offset of grid.getDirectPath([half(path[n - 1]), half(path[n])]).slice(1) ) {
      const { x, y } = grid.getTopLeftPoint(offset);
      out.push({ ...path[n], x, y });
    }
  }
  return out;
}

/**
 * `preMoveToken` : un trajet qui entre dans une zone d'objets répandus (pour la première fois de ce tour) s'arrête sur sa première
 * case — le reste du trajet n'est pas joué ; la zone rejoue sa sauvegarde à l'arrivée (runtime/areas.mjs). Vrai : le déplacement
 * passe tel quel. Une téléportation n'entre pas « en marchant » ; un trajet qui finit sur cette case passe aussi.
 */
export function scatterStop(token, movement, operation) {
  if ( !token?.actor || isObjectToken(token) || !levelAtLeast("full") ) return true;
  const flags = operation?.[MODULE_ID] ?? continuedFlags(token, movement) ?? null;
  if ( flags?.scatterChecked ) return true;
  // Hors combat, chaque entrée compte (runtime/areas.mjs) ; en combat, la première de ce tour.
  const turnKey = currentTurnKey();
  const zones = scatterZones(token.parent)
    .filter(r => !game.combat?.started || shouldTrigger(readAreaState(r), { event: "enter", token: token.uuid, turnKey }));
  if ( !zones.length ) return true;
  // Tout le trajet de ce déplacement, comme les attaques d'opportunité (runtime/move-gate.mjs) : à `preMoveToken`, un déplacement
  // sans étapes intermédiaires est entier dans `passed`.
  const waypoints = [...(movement.passed?.waypoints ?? []), ...(movement.pending?.waypoints ?? [])];
  if ( !waypoints.length || waypoints.some(w => CONFIG.Token.movement.actions[w.action]?.teleport || (w.action === "displace")) ) return true;
  const start = positionOf(movement.origin);
  const path = cellSteps(token, token.getCompleteMovementPath([start, ...waypoints.map(positionOf)]).map(positionOf));
  const k = firstEntry(path.map(p => zones.map(r => isInside(token, r, p))));
  if ( (k < 0) || (k >= path.length - 1) ) return true;
  const zone = zones.find(r => isInside(token, r, path[k]));
  const action = waypoints[0].action;
  const cut = path.slice(1, k + 1).map(p => ({ ...p, action }));
  log(`${token.name}: steps onto ${zone?.name ?? "a scattered item"}, stops there`);
  token.move(cut, { ...walkOptions(movement), [MODULE_ID]: { ...(flags ?? {}), scatterChecked: true } })
    .catch(err => console.error(`${MODULE_ID} | scattered item: stop on entry`, err));
  return false;
}

/* -------------------------------------------- */
/*  Ramasser                                    */
/* -------------------------------------------- */

/** Les zones d'objets répandus que ce token peut ramasser : hors combat, sur la zone ou au contact. */
export function pickableNear(token) {
  if ( !token?.actor || isObjectToken(token) || game.combat?.started || !levelAtLeast("full") ) return [];
  const grid = token.parent.grid;
  const at = committedPosition(token);
  const around = [];
  for ( const dx of [-1, 0, 1] ) for ( const dy of [-1, 0, 1] ) around.push({ ...at, x: at.x + (dx * grid.sizeX), y: at.y + (dy * grid.sizeY) });
  return scatterZones(token.parent).filter(r => around.some(p => isInside(token, r, p)));
}

/** Les entrées du menu de son propre token : « Ramasser : Chausse-trapes ». */
export function pickUpEntries(token) {
  if ( !token?.isOwner ) return [];
  return pickableNear(token).map(region => ({
    icon: "fa-solid fa-hand-holding",
    label: loc("Dispersion.Ramasser", { item: readAreaState(region).scatter.item?.name ?? region.name }),
    run: () => pickUp(token, region)
  }));
}

/** Ramasser : par le MJ actif (la région et l'horloge du monde sont à lui). */
export function pickUp(token, region) {
  return viaActiveGM(PICKUP_QUERY, handlePickUp, { token: token.uuid, region: region.uuid },
    { noGm: "Dispersion.SansMJ", fallback: false, timeout: 15000, label: "scattered item: pick up" });
}

/** L'objet revient : une utilisation rendue (billes vidées), sinon un de plus (même identifiant), sinon une copie. */
async function giveBack(actor, data) {
  const id = identifierOf(data).id;
  const same = actor.items.find(i => (i.type === data.type) && (identifierOf(i).id === id));
  if ( same ) {
    const spent = Number(same.system.uses?.spent) || 0;
    if ( spent > 0 ) return same.update({ "system.uses.spent": spent - 1 });
    return same.update({ "system.quantity": (Number(same.system.quantity) || 0) + 1 });
  }
  const copy = foundry.utils.deepClone(data);
  delete copy._id;
  foundry.utils.setProperty(copy, "system.quantity", 1);
  if ( copy.system?.uses ) copy.system.uses.spent = 0;
  return actor.createEmbeddedDocuments("Item", [copy]);
}

export async function handlePickUp({ token: tokenUuid, region: regionUuid }) {
  const token = await fromUuid(tokenUuid);
  const region = await fromUuid(regionUuid);
  const scatter = region ? readAreaState(region)?.scatter : null;
  if ( !token?.actor || !scatter?.item ) return false;
  if ( game.combat?.started ) {
    ui.notifications.warn(loc("Dispersion.EnCombat"));
    return false;
  }
  await giveBack(token.actor, scatter.item);
  await region.delete();
  await game.time.advance(RECOVER_SECONDS);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token }),
    content: `<p>${loc("Dispersion.Ramasse", { name: token.name, item: scatter.item.name })}</p>`
  });
  log(`${token.name} picks up ${scatter.item.name} (10 minutes)`);
  return true;
}

export function registerScatter() {
  // La copie de l'objet, prise avant que dnd5e ne le dépense (les chausse-trapes disparaissent de l'inventaire à l'utilisation). §188 :
  // la case se pose à l'utilisation — l'étalage d'huile du Manuel a `target.prompt` faux : dnd5e met alors `measuredTemplate` à faux
  // avant le hook (documents/activity/mixin.mjs:451) et n'ouvre aucune pose, seulement un bouton sur la carte. Un appelant qui pose
  // lui-même la zone le dit (`areaPlaced` : outils de test) — son `false` ne se distingue pas de celui de dnd5e.
  route("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
    const scatter = scatterOf(activity);
    const ground = contentOf(activity?.item).entry?.flammable?.ground === true;
    if ( !(scatter || ground) ) return;
    if ( activity.target?.template?.type && !activity.target.prompt && usageConfig?.create && !usageConfig[MODULE_ID]?.areaPlaced ) {
      usageConfig.create.measuredTemplate = true;
    }
    if ( scatter && messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.scatterItem`, activity.item.toObject());
  }, { label: "ground item: area placed on use, copy kept" });
  // La tuile part avec sa zone (ramassée, brûlée, ou retirée à la main par le MJ).
  route("deleteRegion", async region => {
    const tile = region.parent?.tiles.find(t => t.getFlag(MODULE_ID, "ground") === region.id);
    if ( tile ) await tile.delete();
  }, { executor: true, label: "ground item: tile not removed" });
  CONFIG.queries[PICKUP_QUERY] = handlePickUp;
}

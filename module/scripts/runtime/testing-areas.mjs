/**
 * Fonctions de test (api.mcp) : zones et murs posés, côtés d'un mur, invocations à un point, tempête, régions. Extrait de
 * runtime/testing.mjs.
 */

import { boltAim, setBoltAim, strike } from "./storm.mjs";
import { cloudOf, cloudCircle } from "../adapter/storm.mjs";
import { MODULE_ID } from "../constants.mjs";
import { currentTeleport } from "./actions.mjs";
import { flipWallSide } from "./wall-side.mjs";
import { sideRegionOf } from "../adapter/wall-side.mjs";
import { sleep } from "./shared.mjs";
import { gmOnly, viewedToken } from "./testing-shared.mjs";
import { move } from "./testing-moves.mjs";
import { rangedAreaOf, rangedPlacementProblem } from "../adapter/self-area.mjs";
import { chainOutliers } from "../adapter/chain.mjs";
import { damageTypeChoices } from "../adapter/messages.mjs";

/**
 * §162 : un mur posé par points, comme la visée de l'interface le ferait après les clics (ui/pointer.mjs, `aimWall`) : l'activité est
 * utilisée avec les points (`aimed: { type: "wall", points }`), la région et ses murs suivent `postUseActivity`. Rend l'id de la région.
 */
export async function wall({ tokenId, itemId, activityId=null, points }) {
  gmOnly();
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId) : item?.system.activities.find(a => a.target?.template?.type === "wall");
  if ( !activity ) throw new Error("wall activity not found");
  const before = new Set(canvas.scene.regions.map(r => r.id));
  await activity.use({ consume: false, create: { measuredTemplate: false },
    [MODULE_ID]: { confirmed: true, autoReact: "none", aimed: { type: "wall", points } } }, { configure: false });
  for ( let i = 0; i < 40; i++ ) {
    const region = canvas.scene.regions.find(r => !before.has(r.id));
    if ( region ) return { regionId: region.id, shapes: region.shapes.map(s => s.type) };
    await sleep(100);
  }
  return { regionId: null };
}

/**
 * §169 : l'état d'un mur à face brûlante — son côté, sa face brûlante (id, formes), ses murs du cœur ; `flip: true` la retourne d'abord
 * (comme l'entrée du menu du lanceur).
 */
export async function wallSide({ regionId, flip=false }) {
  gmOnly();
  const region = canvas.scene?.regions.get(regionId);
  if ( !region ) throw new Error(`region ${regionId} not found`);
  if ( flip ) await flipWallSide(region);
  const burning = sideRegionOf(region);
  return {
    side: region.getFlag(MODULE_ID, "wallSide")?.side ?? null,
    shapes: region.shapes.map(s => s.toObject()),
    burning: burning ? { id: burning.id, shapes: burning.shapes.map(s => s.toObject()), area: burning.getFlag(MODULE_ID, "area") } : null,
    walls: canvas.scene.walls.filter(w => w.getFlag(MODULE_ID, "zone") === region.id).map(w => ({ c: w.c, move: w.move, sight: w.sight })),
    // §170 : ses lumières ; et les sons qu'un module voisin y aurait posés (`flags.*.wall`).
    lights: canvas.scene.lights.filter(l => l.getFlag(MODULE_ID, "region") === region.id).map(l => ({ x: l.x, y: l.y, bright: l.config.bright, dim: l.config.dim })),
    sounds: canvas.scene.sounds.filter(s => Object.values(s.flags ?? {}).some(f => f?.wall === region.id)).length,
    // §172 : ses comportements (terrain difficile, coût de déplacement).
    behaviors: region.behaviors.map(b => ({ type: b.type, system: b.system?.toObject?.() ?? null }))
  };
}

/**
 * Une invocation posée à une case fixe, pour un scénario. L'activité est utilisée sans invoquer (`create.summons: false` :
 * carte, concentration, budget comme en jeu), puis `placeSummons` est appelé avec le premier profil (ou `profile`) ; le
 * placement interactif de dnd5e (`getPlacement`, un clic sur le canevas, dnd5e 6.0.3 dnd5e.mjs:40825-40843, appelé par
 * `placeSummons` :40494) est remplacé par la position donnée, sur CETTE instance d'activité et le temps de l'appel.
 * Outil de test seulement : le moteur, lui, laisse le placement au système.
 */
export async function summonAt({ tokenId, itemId, activityId=null, profile=null, actorUuid=null, x, y }) {
  gmOnly();
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId) : item?.system.activities.find(a => a.type === "summon");
  if ( !activity || (activity.type !== "summon") ) throw new Error("summon activity not found");
  // §84 : sans rien consommer, comme `use` par défaut — un lanceur sans emplacement ouvrait « Plus de charge » chez le MJ (§77).
  const used = await activity.use({ consume: false, create: { summons: false }, [MODULE_ID]: { confirmed: true, autoReact: "none", placeSummons: false } },
    { configure: false });
  activity.getPlacement = async () => [{ x, y, elevation: token.elevation ?? 0, rotation: 0 }];
  // §107 : une invocation « par FP » (Appel de familier) demande la créature au joueur (summon.mjs, `queryActor`) — fournie ici.
  if ( actorUuid ) activity.queryActor = async () => actorUuid;
  try {
    const created = await activity.placeSummons({ profile: profile ?? activity.profiles[0]?._id });
    return { messageId: used?.message?.id ?? null, tokens: (created ?? []).map(t => ({ id: t.id, name: t.name, actorId: t.actorId })) };
  } finally {
    delete activity.getPlacement;
    delete activity.queryActor;
  }
}

/** La visée d'une téléportation en cours sur ce client : celle du moteur, et la planification du cœur (`_movementPlanningContext`). */
export function planning() {
  const ctx = canvas.tokens?._movementPlanningContext ?? null;
  return { teleporting: currentTeleport()?.token?.name ?? null, planning: ctx?.object?.name ?? null,
    controlled: canvas.tokens?.controlled.map(t => t.name) ?? [] };
}

/** §70 : le clic de la visée de l'éclair (un point de la scène) : la pose du cœur est fermée, l'éclair posé au point. */
export async function stormStrike({ x, y }) {
  const aim = boltAim();
  if ( !aim ) return { struck: false };
  setBoltAim(null);
  canvas.regions._cancelPlacement?.();
  const region = await strike(aim.activity, aim.cloud, { x, y });
  return { struck: !!region, regionId: region?.id ?? null };
}

/**
 * §70 : valide la pose de région en cours (`RegionLayer#placeRegion` : celle de dnd5e pour la zone d'un sort, ou la visée de
 * l'éclair) au point (x, y) de la scène, comme un clic : la forme y est centrée, puis la fin de `#nextPlacement` est rejouée
 * (client/canvas/layers/regions.mjs:1146-1191 : création si `create`, sinon le document rendu). Une seule forme.
 */
export async function placeRegionAt({ x, y }) {
  const ctx = canvas.regions._placementContext;
  if ( !ctx ) return { placed: false };
  const { preview, resolve, create, createOptions, preCommit, destroyPreview, preConfirm, regionIndex, regionCount } = ctx;
  const document = preview.document;
  const shape = document.shapes[0]?.toObject?.() ?? null;
  if ( !shape ) return { placed: false };
  const center = shapeCenterOf(shape);
  const moved = (shape.type === "polygon")
    ? { ...shape, points: shape.points.map((v, i) => v + ((i % 2) ? (y - center.y) : (x - center.x))) }
    : (shape.type === "rectangle") ? { ...shape, x: x - (shape.width / 2), y: y - (shape.height / 2) } : { ...shape, x, y };
  document.updateSource({ shapes: [moved] });
  // Comme `#confirmPlacement` : le rappel du demandeur (dnd5e y relève la forme posée, template-placement.mjs:36).
  if ( preConfirm && (preConfirm({ event: null, document, regionIndex, regionCount, shape: ctx.shape, shapeIndex: 0, shapeCount: 1 }) === false) ) return { placed: false };
  // `_cancelPlacement` détruit l'aperçu (son document est celui qu'on rend) : on lui en laisse un factice, et on finit comme le cœur.
  ctx.resolve = () => {};
  ctx.preview = { destroyed: true };
  canvas.regions._cancelPlacement();
  let region = null;
  if ( !preCommit || ((await preCommit(Object.freeze([document]))) !== false) ) {
    if ( create ) region = await CONFIG.Region.documentClass.create(document.toObject(), { controlObject: true, ...(createOptions ?? {}), parent: document.parent });
    else {
      region = document;
      if ( destroyPreview ) { region._object = null; region._destroyed = false; }
    }
  }
  resolve(region);
  if ( (!region || destroyPreview) && !preview.destroyed ) preview.destroy({ children: true });
  return { placed: true, regionId: create ? region?.id ?? null : null, shape: moved.type };
}

const shapeCenterOf = shape => (Array.isArray(shape.points)
  ? { x: shape.points.filter((_, i) => !(i % 2)).reduce((a, b) => a + b, 0) / (shape.points.length / 2),
      y: shape.points.filter((_, i) => i % 2).reduce((a, b) => a + b, 0) / (shape.points.length / 2) }
  : (shape.type === "rectangle") ? { x: shape.x + (shape.width / 2), y: shape.y + (shape.height / 2) } : { x: shape.x, y: shape.y });

/** §70 : l'orage d'un item sur la scène (nuage, « déjà là », visée en cours). */
export function storm({ tokenId, itemId }) {
  const item = viewedToken({ tokenId }).actor?.items.get(itemId);
  const cloud = cloudOf(item);
  return { cloud: cloud ? { id: cloud.id, stormy: !!cloud.getFlag(MODULE_ID, "stormy"), behaviors: cloud.behaviors.map(b => b.type),
    visibility: cloud.visibility, circle: cloudCircle(cloud) } : null, aiming: !!boltAim() };
}

/**
 * §286 : ce que la pose refuserait pour ces formes de l'activité de zone de l'item (`far`, `hidden`, `apart` — cubes non contigus),
 * ou null ; sans ouvrir la pose de dnd5e. `shapes` : formes de région en pixels (`circle` { x, y, radius }, `rectangle` { x, y,
 * width, height }).
 */
export function rangedPlacement({ tokenId, itemId, shapes }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const item = (token.document ?? token).actor?.items.get(itemId);
  const activity = item?.system.activities.find(a => a.target?.template?.type);
  if ( !activity ) throw new Error("area activity not found");
  const area = rangedAreaOf(activity);
  return { area: area ? { count: area.count, contiguous: area.contiguous, range: area.range } : null, problem: area ? rangedPlacementProblem(area, shapes) : null };
}

/** §286 : Chaîne d'éclairs — les cibles (après la première) trop loin de la première, par nom. */
export function chainCheck({ tokenId, itemId, targetIds }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const item = (token.document ?? token).actor?.items.get(itemId);
  const activity = item?.system.activities.contents[0];
  if ( !activity ) throw new Error("activity not found");
  const targets = targetIds.map(id => canvas.scene.tokens.get(id)).filter(t => t);
  return { outliers: chainOutliers(activity, targets).map(t => t.name) };
}

/** §287 : la lumière du token telle que la rendent ses effets (`token.light.*` appliqués par le cœur), pas celle de sa source. */
export function tokenLight({ tokenId }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const light = (token.document ?? token).light ?? {};
  return { bright: Number(light.bright) || 0, dim: Number(light.dim) || 0, color: light.color ? String(light.color) : null };
}

/** §288 : les types de dégâts au choix de l'attaque d'un item (Coup au but : celui de l'arme ou radiant), tels que le jet les proposera. */
export function damageTypes({ tokenId, itemId }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const item = (token.document ?? token).actor?.items.get(itemId);
  const activity = item?.system.activities.find(a => a.type === "attack");
  if ( !activity ) throw new Error("attack activity not found");
  return { name: item.name, base: Array.from(item.system.damage?.base?.types ?? []), choices: damageTypeChoices(activity) };
}

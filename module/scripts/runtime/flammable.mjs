/**
 * §188 : les zones inflammables (`flammable`, content/) — l'Huile étalée au sol, la Toile d'araignée. Une zone s'embrase :
 *  a. quand une créature qui s'y tient subit des dégâts de feu ;
 *  b. quand une zone de feu (une activité qui inflige du feu) est posée par-dessus ;
 *  c. par l'entrée « Allumer » du menu de son propre token, au contact, avec une source de lumière portée allumée ou une boîte à
 *     amadou.
 * Embrasée, elle inflige ses dégâts de feu aux moments dits (une fois par tour ; hors combat, à chaque entrée), éclaire, et disparaît à
 * la fin du même tour `rounds` rounds plus tard (`seconds` hors combat). La Toile libère alors ceux qu'elle entravait.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { readAreaState, writeAreaState, lastingRegions, isInside } from "../adapter/areas.mjs";
import { committedPosition, tokenCenter } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { carriedLightsOf, carriedLightEffect } from "../adapter/carried-lights.mjs";
import { burnedOut } from "../core/area.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { levelAtLeast } from "./levels.mjs";
import { log, loc, say, viaActiveGM, waitForDice } from "./shared.mjs";
import { groundTile } from "./scatter.mjs";
import { catchFireFromZone } from "./burning.mjs";

export const IGNITE_QUERY = `${MODULE_ID}.ignite`;
/** Lumière d'une flaque en feu : celle d'un feu de camp (vive 3 m, faible 6 m de plus), vacillante. */
const FIRE_LIGHT = { bright: 10, dim: 20, color: "#ff9329", alpha: 0.5, animation: { type: "torch", speed: 3, intensity: 3 } };

/** La règle d'inflammabilité de l'item d'une activité, ou null. */
export function flammableOf(activity) {
  return contentOf(activity?.item).entry?.flammable ?? null;
}

/** La règle d'une zone posée par un item inflammable (état de la zone, sinon l'item de la région). */
function ruleOfRegion(region) {
  const state = readAreaState(region);
  if ( state?.flammable ) return state.flammable;
  const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
  return contentOf(item).entry?.flammable ?? null;
}

/** Les zones inflammables pas encore en feu de cette scène. */
export function unlitZones(scene) {
  return lastingRegions(scene).filter(r => ruleOfRegion(r) && !readAreaState(r)?.burning);
}

/** Une activité inflige-t-elle du feu (zone de feu, §188 b) ? */
function dealsFire(activity) {
  // L'étalage d'huile porte « 5 feu » dans la donnée (la flaque en feu) : poser une flaque n'en allume pas une autre.
  if ( contentOf(activity?.item).entry?.flammable ) return false;
  return (activity?.damage?.parts ?? []).some(p => Array.from(p.types ?? []).includes("fire"));
}

/* -------------------------------------------- */
/*  Embrasement                                 */
/* -------------------------------------------- */

/** Le centre d'une région (pixels), d'après le rectangle de ses formes. */
function centerOf(region) {
  const xs = [];
  const ys = [];
  for ( const shape of region._source.shapes ?? [] ) {
    if ( Array.isArray(shape.points) ) shape.points.forEach((v, i) => (i % 2 ? ys : xs).push(v));
    else if ( Number.isFinite(shape.width) ) { xs.push(shape.x, shape.x + shape.width); ys.push(shape.y, shape.y + shape.height); }
    else if ( Number.isFinite(shape.radius) ) { xs.push(shape.x - shape.radius, shape.x + shape.radius); ys.push(shape.y - shape.radius, shape.y + shape.radius); }
  }
  if ( !xs.length ) return null;
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * La zone s'embrase. MJ actif. En combat, elle s'éteint à la fin du même tour `rounds` rounds plus tard ; hors combat, après `seconds`
 * (minuterie, et l'heure du monde en filet : `expiresAt`, runtime/areas.mjs).
 */
export async function ignite(region, cause="") {
  return enqueue(`area:${region.id}`, async () => {
    const state = readAreaState(region);
    const rule = ruleOfRegion(region);
    if ( !state || !rule || state.burning || !region.parent ) return false;
    const combat = game.combat?.started ? game.combat : null;
    const until = combat ? { round: combat.round + rule.rounds, turn: combat.turn ?? 0 } : null;
    const center = centerOf(region);
    const [light] = center ? await region.parent.createEmbeddedDocuments("AmbientLight", [{
      x: Math.round(center.x), y: Math.round(center.y), walls: true, vision: false,
      levels: Array.from(region.levels ?? []), config: { ...FIRE_LIGHT },
      flags: { [MODULE_ID]: { burning: region.id } }
    }]).catch(() => []) : [];
    await writeAreaState(region, {
      ...state, on: [...rule.on], turnKey: null, hit: [], activities: null,
      burning: { damage: rule.damage, type: rule.type, until, frees: rule.frees ?? null, light: light?.id ?? null }
    });
    if ( !combat ) {
      await region.setFlag(MODULE_ID, "expiresAt", game.time.worldTime + rule.seconds);
      setTimeout(() => { if ( region.parent?.regions.get(region.id) ) region.delete().catch(() => {}); }, rule.seconds * 1000);
    }
    const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
    const name = item?.name ?? region.name;
    log(`${name}: ignited${cause ? ` (${cause})` : ""}, burns ${combat ? `until the end of round ${until.round}, turn ${until.turn}` : `${rule.seconds} s`}`);
    await say({ alias: name }, loc("Embrase.Prend", { item: name }), { ignited: { region: region.uuid } });
    return true;
  });
}

/** Embraser par une requête au MJ actif (un joueur ne peut pas modifier une région). */
export function igniteViaGM(region, cause="") {
  return viaActiveGM(IGNITE_QUERY, handleIgnite, { region: region.uuid, cause }, { noGm: "Embrase.SansMJ", fallback: false, label: "flammable: ignite" });
}

async function handleIgnite({ region: uuid, cause }) {
  const region = await fromUuid(uuid);
  return region ? ignite(region, cause) : false;
}

/**
 * §188 b : une zone de feu vient d'être posée — elle embrase les zones inflammables qu'elle recouvre (un point d'une case de la zone
 * inflammable dans la zone de feu). MJ actif (pose de zone).
 */
export async function igniteUnder(fireRegion, activity) {
  if ( !levelAtLeast("full") || !dealsFire(activity) ) return 0;
  let n = 0;
  for ( const zone of unlitZones(fireRegion.parent) ) {
    if ( zone === fireRegion ) continue;
    if ( overlaps(zone, fireRegion) && await ignite(zone, activity.item?.name ?? "fire") ) n++;
  }
  return n;
}

/** Deux régions se recouvrent-elles ? Les centres des cases de la première, testés dans la seconde. */
function overlaps(zone, other) {
  const grid = zone.parent.grid;
  const center = centerOf(zone);
  if ( !center ) return false;
  const elevation = Number.isFinite(zone.elevation?.bottom) ? zone.elevation.bottom : 0;
  const points = [center];
  const bounds = zone.object?.bounds ?? null;
  if ( bounds ) {
    for ( let x = bounds.x + (grid.sizeX / 2); x < bounds.right; x += grid.sizeX ) {
      for ( let y = bounds.y + (grid.sizeY / 2); y < bounds.bottom; y += grid.sizeY ) if ( zone.testPoint({ x, y, elevation }) ) points.push({ x, y });
    }
  }
  return points.some(p => other.testPoint({ ...p, elevation }));
}

/* -------------------------------------------- */
/*  Brûler                                      */
/* -------------------------------------------- */

/**
 * La zone en feu agit sur un token (runtime/areas.mjs, à la place du rejeu) : ses dégâts lancés, montrés, appliqués (résistances de
 * dnd5e ; une créature huilée prend ses 5 de plus, runtime/oil.mjs). MJ actif.
 */
export async function burnTick(region, token, burning) {
  const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
  const name = item?.name ?? region.name;
  const roll = await new Roll(burning.damage).evaluate();
  const message = await roll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ token }),
    flavor: loc("Embrase.Brule", { name: token.name, item: name, amount: roll.total })
  });
  await waitForDice(message);
  await token.actor?.applyDamage([{ value: roll.total, type: burning.type }]);
  log(`${name}: ${token.name} burns, ${roll.total} ${burning.type}`);
  // §212 : propagation maison — brûlée par la zone, la créature prend feu (réglage `fireSpread`).
  await catchFireFromZone(token, name);
}

/** Le tour vient de changer : les zones dont le feu atteint son terme s'éteignent (après les brûlures de fin de tour, même file). */
function onTurnChange(combat, prior) {
  const scene = combat.scene ?? canvas.scene;
  if ( !prior || !Number.isFinite(prior.round) ) return;
  for ( const region of lastingRegions(scene) ) {
    const until = readAreaState(region)?.burning?.until;
    if ( !burnedOut(until, prior) ) continue;
    enqueue(`area:${region.id}`, async () => {
      if ( !region.parent?.regions.get(region.id) ) return;
      log(`${region.name}: burnt out`);
      await region.delete();
    }).catch(err => console.error(`${MODULE_ID} | flammable: burn out`, err));
  }
}

/** Le combat se termine : un feu qui comptait en tours s'éteint avec lui. */
async function onCombatEnd(combat) {
  const scene = combat.scene ?? canvas.scene;
  for ( const region of lastingRegions(scene) ) {
    if ( readAreaState(region)?.burning?.until ) await region.delete().catch(() => {});
  }
}

/** La zone part (éteinte, brûlée, retirée) : sa lumière aussi ; la Toile libère ceux qu'elle entravait (`frees`). */
async function onRegionDeleted(region) {
  const burning = readAreaState(region)?.burning;
  if ( !burning ) return;
  const light = region.parent?.lights.find(l => l.getFlag(MODULE_ID, "burning") === region.id);
  if ( light ) await light.delete();
  const activity = region.getFlag("dnd5e", "activity");
  if ( !burning.frees || !activity ) return;
  for ( const token of region.parent?.tokens ?? [] ) {
    const held = (token.actor?.effects ?? []).filter(e => (e.origin === activity) && e.statuses?.has(burning.frees));
    if ( held.length ) {
      await token.actor.deleteEmbeddedDocuments("ActiveEffect", held.map(e => e.id));
      log(`${token.name}: freed, the web burnt away`);
    }
  }
}

/* -------------------------------------------- */
/*  Allumer : dégâts de feu reçus, flamme       */
/* -------------------------------------------- */

const lastFire = new WeakMap();

/** §188 a : une créature dans une zone inflammable subit des dégâts de feu — la zone s'embrase. */
async function onFireApplied(actor, amount) {
  const fire = lastFire.get(actor);
  lastFire.delete(actor);
  if ( !fire || !(amount > 0) || !canvas?.scene || !levelAtLeast("full") ) return;
  const zones = unlitZones(canvas.scene);
  if ( !zones.length ) return;
  for ( const token of actor.getActiveTokens(false, true) ) {
    for ( const zone of zones ) if ( isInside(token, zone) ) await igniteViaGM(zone, `${token.name} takes fire damage`);
  }
}

/** Ce token a-t-il de quoi allumer : une source portée allumée (torche, lampe…), ou une boîte à amadou ? */
function hasFlame(actor) {
  return carriedLightsOf(actor).some(i => { const e = carriedLightEffect(i); return e && !e.disabled; })
    || (actor?.items ?? []).some(i => contentOf(i).entry?.kindles === true);
}

/** §188 c : les zones inflammables que ce token peut allumer — sur la zone ou au contact, avec une flamme. */
export function ignitableNear(token) {
  if ( !token?.actor || isObjectToken(token) || !levelAtLeast("full") || !hasFlame(token.actor) ) return [];
  const grid = token.parent.grid;
  const at = committedPosition(token);
  const around = [];
  for ( const dx of [-1, 0, 1] ) for ( const dy of [-1, 0, 1] ) around.push({ ...at, x: at.x + (dx * grid.sizeX), y: at.y + (dy * grid.sizeY) });
  return unlitZones(token.parent).filter(r => around.some(p => isInside(token, r, p)));
}

/** Les entrées du menu de son propre token : « Allumer : Huile ». */
export function igniteEntries(token) {
  if ( !token?.isOwner ) return [];
  return ignitableNear(token).map(region => {
    const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
    return { icon: "fa-solid fa-fire", label: loc("Embrase.Allumer", { item: item?.name ?? region.name }), run: () => igniteViaGM(region, `lit by ${token.name}`) };
  });
}

/* -------------------------------------------- */
/*  Viser une zone (§189)                       */
/* -------------------------------------------- */

/**
 * §189 : en visée d'une action de feu à cible unique (Trait de feu), la zone inflammable pas encore en feu sous ce point — `{ zone }`,
 * `{ zone, refused: "outOfRange" }` au-delà de la portée (la longue, s'il y en a une ; « au contact » : 1,50 m), ou null. Appelée
 * seulement quand aucune créature n'est sous la souris : un token sur la zone reste la cible.
 */
export function fireTargetAt(token, activity, point) {
  if ( !token?.parent || !point || !levelAtLeast("full") || !dealsFire(activity) ) return null;
  const zone = unlitZones(token.parent).find(r => r.testPoint({ x: point.x, y: point.y,
    elevation: Number.isFinite(r.elevation?.bottom) ? r.elevation.bottom : 0 }));
  if ( !zone ) return null;
  const range = activity.range ?? {};
  const touch = range.units === "touch";
  const max = touch ? 5 : (Number(range.long) || Number(range.value) || 0);
  const units = touch ? "ft" : range.units;
  if ( max && units && (units !== "self") && (units !== "any") ) {
    const grid = token.parent.grid;
    const limit = lengthIn(max, units, grid.units);
    const center = centerOf(zone);
    const from = tokenCenter(token);
    const distance = center ? grid.measurePath([{ x: from.x, y: from.y }, center]).distance : 0;
    // Du bord de l'espace du lanceur à la case de la zone la plus proche : leurs demi-largeurs sont retirées de la distance des centres.
    const half = (grid.distance ?? 5) / 2;
    const body = ((committedPosition(token).width || 1) * (grid.distance ?? 5)) / 2;
    if ( (distance - half - body) > limit + 1e-6 ) return { zone, refused: "outOfRange" };
  }
  return { zone };
}

/**
 * §189 : l'action de feu part sur la zone visée — son utilisation (coût, emplacement, carte), sans créature ciblée ni jet enchaîné, puis
 * la zone s'embrase. `usage` : les configurations suspendues par la visée.
 */
export async function igniteWithActivity(token, activity, usage, zone) {
  const [config={}, dialog={}, message={}] = usage ?? [];
  // Aucune créature ciblée : l'action part sur la zone seule.
  for ( const t of [...(game.user.targets ?? [])] ) t.setTarget(false, { releaseOthers: false });
  const results = await activity.use({ ...config, subsequentActions: false, [MODULE_ID]: { ...(config[MODULE_ID] ?? {}), igniteZone: zone.uuid } },
    { ...dialog, configure: false }, message);
  if ( !results ) return false;
  log(`${activity.item?.name}: aimed at ${zone.name}`);
  return igniteViaGM(zone, activity.item?.name ?? "fire");
}

/* -------------------------------------------- */
/*  Pose                                        */
/* -------------------------------------------- */

/** §188 : ce qu'une zone inflammable posée au sol garde (Huile) : sa règle et l'image de l'objet. MJ actif. */
export async function groundFlammableState(region, activity) {
  const rule = flammableOf(activity);
  const tile = await groundTile(region, activity?.item?.img);
  log(`${activity?.item?.name ?? region.name}: spread on the ground, flammable`);
  return { flammable: rule, ground: { tile: tile?.id ?? null } };
}

export function registerFlammable() {
  route("dnd5e.calculateDamage", (actor, damages) => {
    lastFire.set(actor, Array.from(damages ?? []).some(d => (d.type === "fire") && (Number(d.value) > 0)));
  }, { label: "flammable: fire damage not noted" });
  route("dnd5e.applyDamage", (actor, amount) => { onFireApplied(actor, amount).catch(err => console.error(`${MODULE_ID} | flammable`, err)); },
    { label: "flammable: not ignited by fire damage" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "flammable: not burnt out" });
  route("deleteCombat", onCombatEnd, { executor: true, label: "flammable: fire not put out with the combat" });
  route("deleteRegion", onRegionDeleted, { executor: true, label: "flammable: light or held creatures left behind" });
  CONFIG.queries[IGNITE_QUERY] = handleIgnite;
}


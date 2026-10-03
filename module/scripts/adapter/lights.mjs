/**
 * Lumière et ténèbres des sorts (SPEC §16.31), lues et écrites dans Foundry. Rien n'est patché : le cœur V14 fournit tout.
 *  - Zone (`light.on: "area"`) : une lumière ambiante (AmbientLight) au centre de la région que dnd5e a posée, de ses rayons
 *    ou, pour des ténèbres, une source négative du rayon de la zone (`config.negative`, common/data/data.mjs:26 : « darkness
 *    source ») — le cœur rend alors ce qui s'y trouve invisible aux autres et aveugle qui s'y tient
 *    (point-vision-source.mjs:186-190, detection-mode.mjs:109). Elle suit la région (une région attachée à un token est
 *    déplacée avec lui par le cœur, documents/token.mjs:2486, d'où un `updateRegion`) et disparaît avec elle.
 *  - Effet (`on: "effect"`) : l'effet posé reçoit, à sa création, des changements `token.light.*` — appliqués au token par
 *    le cœur V14 (client/documents/actor.mjs:248, TokenDocument#applyActiveEffects) et retirés avec l'effet.
 *  - Invocation (`on: "summon"`) : l'objet invoqué porte déjà sa lumière (acteur « Lumière » du PHB : 20/40 ft). `carried` :
 *    au lancement, le joueur choisit (ui/light.mjs) « au sol » (l'objet est posé) ou « sur moi » (le lanceur reçoit un effet
 *    qui le fait briller de la même lumière), et la couleur. `single` : les lumières précédentes du même sort s'éteignent.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { summonItemOf } from "./summons.mjs";
import { readUnitFactors } from "./units.mjs";
import { convertLength } from "../core/units.mjs";
import { shapeCenter } from "../core/area.mjs";
import { areaLightRadii, tokenLightChanges, dispelledBy } from "../core/light.mjs";

/** La règle de lumière d'un item, ou null. */
export function lightRuleOf(item) {
  return item ? (contentOf(item).entry?.light ?? null) : null;
}

/** L'activité et la règle de lumière de zone d'une région posée par dnd5e, ou null. */
function areaRuleOf(region) {
  const uuid = region.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  const rule = lightRuleOf(activity?.item);
  return (rule?.on === "area") ? { activity, rule } : null;
}

function toGridUnits(value, units, grid) {
  if ( !units ) return value;
  try { return convertLength(value, units, grid.units, readUnitFactors()); }
  catch { return value; }
}

/** Le centre d'une région, en pixels : l'origine de sa première forme (cercle, émanation d'un token…). */
function regionCenter(region) {
  const shape = region.shapes?.[0];
  const origin = shape?.origin;
  if ( Number.isFinite(origin?.x) && Number.isFinite(origin?.y) ) return { x: origin.x, y: origin.y };
  return shapeCenter(shape?.toObject?.() ?? region._source?.shapes?.[0] ?? null);
}

/**
 * Le rayon d'une zone, unité de la grille : les dimensions que dnd5e a notées à la pose (template-placement.mjs:154) ; à
 * défaut (région posée par une macro, le connecteur), le rayon de sa première forme ronde.
 */
function regionRadius(region) {
  const grid = region.parent.grid;
  const dims = region.getFlag?.("dnd5e", "dimensions");
  const size = Number(dims?.size);
  if ( Number.isFinite(size) && (size > 0) ) return toGridUnits(size, dims.units, grid);
  const shape = region.shapes?.[0]?.toObject?.() ?? region._source?.shapes?.[0] ?? {};
  const px = [shape.radius, shape.radiusX].find(Number.isFinite);
  return Number.isFinite(px) ? (px / grid.size) * grid.distance : 0;
}

/** L'élévation de la source : le milieu de la tranche de la zone, sinon son bas, sinon le sol. */
function regionElevation(region) {
  const { bottom, top } = region.elevation ?? {};
  if ( Number.isFinite(bottom) && Number.isFinite(top) ) return (bottom + top) / 2;
  return Number.isFinite(bottom) ? bottom : 0;
}

/** Les lumières que le moteur a posées pour cette région. */
function lightsOf(region) {
  return region.parent.lights.filter(l => l.getFlag(MODULE_ID, "region") === region.id);
}

/**
 * Une zone vient d'être posée : sa lumière (ou ses ténèbres), et ce qu'elle dissipe. MJ actif.
 * @returns {Promise<{light: AmbientLightDocument, dispelled: number}|null>}
 */
export async function lightUpRegion(region) {
  const found = areaRuleOf(region);
  if ( !found || lightsOf(region).length ) return null;
  const { rule } = found;
  const grid = region.parent.grid;
  const center = regionCenter(region);
  if ( !center ) return null;
  const radius = regionRadius(region);
  const radii = areaLightRadii({
    darkness: rule.darkness === true,
    bright: Number.isFinite(rule.bright) ? toGridUnits(rule.bright, rule.units, grid) : undefined,
    dim: Number.isFinite(rule.dim) ? toGridUnits(rule.dim, rule.units, grid) : undefined
  }, radius);
  const [light] = await region.parent.createEmbeddedDocuments("AmbientLight", [{
    x: Math.round(center.x), y: Math.round(center.y), elevation: regionElevation(region),
    levels: Array.from(region.levels ?? []), walls: true, vision: false,
    config: { bright: radii.bright, dim: radii.dim, negative: radii.negative },
    flags: { [MODULE_ID]: { region: region.id, darkness: radii.negative } }
  }]);
  // Après la pose : un défaut en dissipant ne laisse pas la zone sans sa lumière.
  const dispelled = Number.isInteger(rule.dispels) ? await dispelDarkness(region, center, radii.dim, rule.dispels) : 0;
  return light ? { light, dispelled } : null;
}

/** La zone a bougé (déplacée, ou emportée par le token auquel elle est attachée) : sa lumière la suit. */
export async function followRegion(region) {
  const lights = lightsOf(region);
  const center = regionCenter(region);
  if ( !lights.length || !center ) return 0;
  const updates = lights.filter(l => (Math.round(center.x) !== l.x) || (Math.round(center.y) !== l.y))
    .map(l => ({ _id: l.id, x: Math.round(center.x), y: Math.round(center.y), elevation: regionElevation(region) }));
  if ( updates.length ) await region.parent.updateEmbeddedDocuments("AmbientLight", updates);
  return updates.length;
}

/** La zone a disparu : sa lumière aussi. */
export async function extinguishRegion(region) {
  const ids = lightsOf(region).map(l => l.id);
  if ( ids.length ) await region.parent.deleteEmbeddedDocuments("AmbientLight", ids);
  return ids.length;
}

/**
 * Lumière du jour : les Ténèbres de niveau ≤ `maxLevel` que la zone recouvre sont dissipées — leur sort prend fin (la
 * concentration qui les tient tombe, runtime/concentration.mjs retire la région), sinon la région est retirée.
 */
async function dispelDarkness(region, center, radius, maxLevel) {
  const scene = region.parent;
  const darkness = [];
  for ( const other of scene.regions ) {
    if ( other === region ) continue;
    const found = areaRuleOf(other);
    if ( !found?.rule.darkness ) continue;
    const c = regionCenter(other);
    if ( !c ) continue;
    // Rayons en pixels pour les comparer aux centres.
    const px = r => (r / scene.grid.distance) * scene.grid.size;
    const level = Number(other.getFlag("dnd5e", "spellLevel"));
    darkness.push({ id: other.id, x: c.x, y: c.y, radius: px(regionRadius(other)), level: Number.isFinite(level) ? level : null });
  }
  const ids = dispelledBy({ x: center.x, y: center.y, radius: (radius / scene.grid.distance) * scene.grid.size }, maxLevel, darkness);
  // La région d'abord, puis la concentration : supprimer l'effet retire aussi la région (runtime/concentration.mjs), et
  // les deux suppressions se croiseraient (vu en jeu : « Region … does not exist »).
  for ( const id of ids ) {
    const concentration = scene.regions.get(id)?.getFlag(MODULE_ID, "concentration");
    await scene.deleteEmbeddedDocuments("Region", [id]);
    const effect = concentration ? await fromUuid(concentration) : null;
    if ( effect ) await effect.delete();
  }
  return ids.length;
}

/* -------------------------------------------- */
/*  Effets qui font briller                     */
/* -------------------------------------------- */

/**
 * À la création d'un effet (hook `preCreateActiveEffect`, sur le client qui l'écrit) : si l'item d'où il vient fait briller
 * son porteur, l'effet reçoit ses changements `token.light.*`. Rend true si l'effet a été complété.
 */
export function addEffectLight(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return false;
  const rule = lightRuleOf(originItemOf(effect));
  if ( rule?.on !== "effect" ) return false;
  const current = effect._source.system?.changes ?? [];
  if ( current.some(c => c.key?.startsWith("token.light.")) ) return false;
  const grid = canvas?.scene?.grid ?? game.scenes.active?.grid;
  const radius = v => (Number.isFinite(v) && grid) ? toGridUnits(v, rule.units, grid) : (v ?? 0);
  const changes = tokenLightChanges({ bright: radius(rule.bright), dim: radius(rule.dim) });
  effect.updateSource({ "system.changes": [...current, ...changes] });
  return true;
}

/* -------------------------------------------- */
/*  Objets lumineux invoqués                    */
/* -------------------------------------------- */

const SECONDS = { minute: 60, hour: 3600, day: 86400, round: 6, turn: 6 };

/** La durée de l'item, en secondes, pour l'effet (rien pour « jusqu'à dissipation »). */
function durationOf(item) {
  const { value, units } = item.system?.duration ?? {};
  const n = Number(value);
  return (SECONDS[units] && Number.isFinite(n) && (n > 0)) ? { value: n * SECONDS[units], units: "seconds" } : {};
}

/** Une activité d'invocation dont l'objet lumineux peut aussi être tenu par le lanceur (Lumière, Flamme éternelle), ou null. */
export function lightChoiceOf(activity) {
  if ( activity?.type !== "summon" ) return null;
  const rule = lightRuleOf(activity.item);
  return ((rule?.on === "summon") && rule.carried) ? rule : null;
}

/** La lumière de l'objet que l'activité invoque (acteur du premier profil : « Lumière » du PHB, 20/40 ft, orangée). */
export async function summonedLightOf(activity) {
  const uuid = activity.profiles?.[0]?.uuid;
  const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
  const light = actor?.prototypeToken?.light ?? {};
  return { bright: light.bright ?? 20, dim: light.dim ?? 40, color: light.color ? String(light.color) : null,
    alpha: light.alpha ?? null, animation: light.animation ? { ...light.animation } : null };
}

/** La taille de l'objet invoqué : Très petit si le profil le permet (« pas besoin de choisir la taille »), sinon la première. */
export function summonSizeOf(activity) {
  const sizes = Array.from(activity.creatureSizes ?? []);
  return sizes.includes("tiny") ? "tiny" : (sizes[0] ?? null);
}

/**
 * « Sur moi » : le lanceur tient l'objet et brille de sa lumière — un effet (nom, image, durée du sort) qui porte ses
 * changements `token.light.*`, dans la couleur choisie. Sur le client du lanceur : son personnage est à lui.
 */
export async function lightCaster(activity, color=null) {
  const item = activity.item;
  const light = await summonedLightOf(activity);
  const [effect] = await activity.actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name, img: item.img, origin: item.uuid, type: "base", duration: durationOf(item),
    system: { changes: tokenLightChanges({ ...light, color: color ?? light.color }) },
    flags: { [MODULE_ID]: { lightOf: item.uuid } }
  }]);
  return effect ?? null;
}

/** « Au sol » : la couleur choisie passe sur le token de l'objet avant sa création (hook `dnd5e.summonToken`). */
export function colorSummonedToken(activity, tokenData, options) {
  const color = options?.[MODULE_ID]?.lightColor;
  if ( !color || !lightChoiceOf(activity) ) return false;
  foundry.utils.setProperty(tokenData, "light.color", color);
  return true;
}

/** Les lumières allumées par cet item : objets posés (toutes scènes) et effets lumineux sur son lanceur. */
export function lightsOfItem(item) {
  let n = 0;
  for ( const scene of game.scenes ) n += scene.tokens.filter(t => summonItemOf(t)?.uuid === item.uuid).length;
  return n + (item.actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "lightOf") === item.uuid).length;
}

/**
 * Éteint les lumières d'un item (« le sort prend fin si vous le lancez à nouveau ») : ses objets posés, sur toutes les
 * scènes, et les effets lumineux qu'il a laissés sur son lanceur. MJ actif (un joueur ne supprime pas de token).
 * @param {Item} item
 * @param {{keep?: string}} [options]  Id d'un token à garder (celui qui vient d'être posé).
 */
export async function extinguishLights(item, { keep=null }={}) {
  let n = 0;
  for ( const scene of game.scenes ) {
    const ids = scene.tokens.filter(t => (t.id !== keep) && (summonItemOf(t)?.uuid === item.uuid)).map(t => t.id);
    if ( ids.length ) await scene.deleteEmbeddedDocuments("Token", ids);
    n += ids.length;
  }
  const caster = item.actor;
  const old = (caster?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "lightOf") === item.uuid).map(e => e.id);
  if ( old.length ) await caster.deleteEmbeddedDocuments("ActiveEffect", old);
  return n + old.length;
}

/**
 * Un objet lumineux vient d'être invoqué (MJ actif) : avec `single`, les lumières d'un lancement précédent qui
 * resteraient (lancé sans passer par le choix : connecteur, carte) s'éteignent.
 * @returns {Promise<{extinguished: number}|null>}
 */
export async function placeLightObject(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  const rule = lightRuleOf(item);
  if ( rule?.on !== "summon" ) return null;
  return { extinguished: rule.single ? await extinguishLights(item, { keep: tokenDoc.id }) : 0 };
}

/* -------------------------------------------- */
/*  Sources de lumière portées (§52)            */
/* -------------------------------------------- */

const CARRIED_FLAG = "carriedLightOf";

/** La lumière d'une source portée (lampe, lanterne, torche, bougie), ou null. */
export const carriedLightOf = item => contentOf(item).entry?.carriedLight ?? null;

/** L'effet qui fait briller le porteur de cette source, ou null (éteinte). */
export const carriedLightEffect = item => (item?.actor?.effects ?? []).find(e => e.getFlag(MODULE_ID, CARRIED_FLAG) === item.uuid) ?? null;

/** Les sources de lumière que porte un acteur. */
export const carriedLightsOf = actor => (actor?.items ?? []).filter(i => carriedLightOf(i));

/**
 * Allume (`on: true`) ou éteint la source : un effet au nom et à l'image de l'item, qui porte ses changements `token.light.*`
 * (rayons convertis dans l'unité de la scène). Sur le client du porteur. Rend true si l'état a changé.
 */
export async function setCarriedLight(item, on) {
  const rule = carriedLightOf(item);
  const actor = item?.actor;
  if ( !rule || !actor ) return false;
  const lit = carriedLightEffect(item);
  if ( !on ) {
    if ( !lit ) return false;
    await lit.delete();
    return true;
  }
  if ( lit ) return false;
  const grid = canvas?.scene?.grid ?? game.scenes.active?.grid;
  const radius = v => (grid ? toGridUnits(v, rule.units, grid) : v);
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name, img: item.img, origin: item.uuid, type: "base",
    system: { changes: tokenLightChanges({ bright: radius(rule.bright), dim: radius(rule.dim), angle: rule.angle ?? null,
      animation: rule.animation ?? null }) },
    flags: { [MODULE_ID]: { [CARRIED_FLAG]: item.uuid } }
  }]);
  return true;
}

/** Une source qui quitte la fiche (lâchée, lancée, donnée, détruite) s'éteint : ses effets lumineux sont retirés. */
export async function dropCarriedLight(item) {
  const actor = item?.parent;
  if ( actor?.documentName !== "Actor" ) return 0;
  const ids = actor.effects.filter(e => e.getFlag(MODULE_ID, CARRIED_FLAG) === item.uuid).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

/**
 * Lumière et ténèbres des sorts (SPEC §16.31), lues et écrites dans Foundry. Rien n'est patché : le cœur V14 fournit tout.
 *  - Zone (`light.on: "area"`) : une lumière ambiante (AmbientLight) au centre de la région que dnd5e a posée, de ses rayons
 *    ou, pour des ténèbres, une source négative du rayon de la zone (`config.negative`, common/data/data.mjs:26 : « darkness
 *    source ») — le cœur rend alors ce qui s'y trouve invisible aux autres et aveugle qui s'y tient
 *    (point-vision-source.mjs:186-190, detection-mode.mjs:109). Elle suit la région (une région attachée à un token est
 *    déplacée avec lui par le cœur, documents/token.mjs:2486, d'où un `updateRegion`) et disparaît avec elle.
 *  - Effet (`on: "effect"`) : l'effet posé reçoit, à sa création, des changements `token.light.*` — appliqués au token par
 *    le cœur V14 (client/documents/actor.mjs:248, TokenDocument#applyActiveEffects) et retirés avec l'effet.
 *  - Mur (`on: "wall"`, §170) : une rangée de lumières ambiantes de chaque côté d'un mur posé par points, reposée s'il est redessiné.
 *  - Invocation (`on: "summon"`) : l'objet invoqué porte déjà sa lumière (acteur « Lumière » du PHB : 20/40 ft). `carried` :
 *    au lancement, le joueur choisit (ui/light.mjs) « au sol » (l'objet est posé) ou « sur moi » (le lanceur reçoit un effet
 *    qui le fait briller de la même lumière), et la couleur. `single` : les lumières précédentes du même sort s'éteignent.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { summonItemOf } from "./summons.mjs";
import { shapeCenter } from "../core/area.mjs";
import { areaLightRadii, tokenLightChanges, dispelledBy } from "../core/light.mjs";
import { wallLightPoints } from "../core/wall.mjs";
import { wallGeometryOf } from "./wall-side.mjs";
import { lengthIn } from "./units.mjs";
export { burnLeftOf, burnOut, carriedLightEffect, carriedLightOf, carriedLightState, carriedLightsOf, carriedSourceOf, dropCarriedLight, fuelOf, heldItems, remainingOf, rememberBurn, setCarriedLight } from "./carried-lights.mjs";

/** La règle de lumière d'un item, ou null. */
export function lightRuleOf(item) {
  return item ? (contentOf(item).entry?.light ?? null) : null;
}

/** L'activité et la règle de lumière d'une région posée par dnd5e (`on` : « area » par défaut, ou « wall »), ou null. */
function areaRuleOf(region, on="area") {
  const uuid = region.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  const rule = lightRuleOf(activity?.item);
  return (rule?.on === on) ? { activity, rule } : null;
}

export function toGridUnits(value, units, grid) {
  if ( !units ) return value;
  return lengthIn(value, units, grid.units);
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
  const wall = areaRuleOf(region, "wall");
  if ( wall ) return lightUpWall(region, wall.rule);
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
  // §287 : des ténèbres qui dissipent (Ténèbres) visent les lumières de sort ; une lumière (Lumière du jour), les ténèbres.
  const lightsDispelled = (Number.isInteger(rule.dispels) && rule.darkness) ? await dispelLights(region, center, radius, rule.dispels) : [];
  const dispelled = (Number.isInteger(rule.dispels) && !rule.darkness) ? await dispelDarkness(region, center, radii.dim, rule.dispels) : lightsDispelled.length;
  return light ? { light, dispelled, lightsDispelled } : null;
}

/**
 * §170 : un mur posé par points (Mur de feu) — une rangée de sources de chaque côté, tous les 3 m (§173 : la moitié du rayon pour une
 * grande lumière), à un dixième de case de la ligne
 * (le mur arrête la lumière : chaque rangée éclaire son côté). Couleur et animation de la règle ; transparence réduite, les sources se
 * recouvrant. MJ actif.
 */
async function lightUpWall(region, rule) {
  if ( lightsOf(region).length ) return null;
  const geometry = wallGeometryOf(region);
  if ( !geometry ) return null;
  const grid = region.parent.grid;
  const perUnit = grid.size / grid.distance;
  // Tous les 3 m ; plus espacées pour une grande lumière (Mur prismatique : 30 m) — la moitié de son rayon le plus court.
  const shortest = Math.min(...[rule.bright, rule.dim].filter(v => Number.isFinite(v) && (v > 0)));
  const step = toGridUnits(Math.max(10, shortest / 2), rule.units ?? "ft", grid) * perUnit;
  const points = wallLightPoints(geometry, step, grid.size / 10);
  const config = {
    bright: Number.isFinite(rule.bright) ? toGridUnits(rule.bright, rule.units, grid) : 0,
    dim: Number.isFinite(rule.dim) ? toGridUnits(rule.dim, rule.units, grid) : 0,
    ...(rule.color ? { color: rule.color, alpha: 0.25 } : {}),
    ...(rule.animation ? { animation: { ...rule.animation } } : {})
  };
  const created = await region.parent.createEmbeddedDocuments("AmbientLight", points.map(p => ({
    x: p.x, y: p.y, elevation: regionElevation(region), levels: Array.from(region.levels ?? []), walls: true, vision: false,
    config, flags: { [MODULE_ID]: { region: region.id } }
  })));
  return created.length ? { light: created[0], dispelled: 0, count: created.length } : null;
}

/** La zone a bougé (déplacée, ou emportée par le token auquel elle est attachée) : sa lumière la suit. */
export async function followRegion(region) {
  // §170 : un mur redessiné (le disque changé en anneau) — ses lumières sont reposées.
  if ( areaRuleOf(region, "wall") ) {
    const n = await extinguishRegion(region);
    const done = await lightUpRegion(region);
    return (n || done) ? (done?.count ?? 0) : 0;
  }
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

/** Le niveau du sort d'où vient une lumière : celui noté par dnd5e (lancement surclassé compris), sinon celui de l'item. */
function spellLevelOf(doc, item) {
  const noted = Number(doc?.getFlag?.("dnd5e", "spellLevel"));
  if ( Number.isFinite(noted) ) return noted;
  return (item?.type === "spell") ? (Number(item.system.level) || 0) : null;
}

/**
 * Le sort d'où vient une lumière prend fin : sa concentration tombe s'il en a une (dnd5e retire ce qui en dépend), sinon ses
 * lumières s'éteignent (objets posés, effets lumineux sur le lanceur) et ses effets lumineux partent de qui les porte.
 */
async function endLightSpell(item, carrier=null) {
  const caster = item.actor;
  const concentration = caster?.effects.find(e => (e.getFlag("dnd5e", "item")?.id === item.id) && e.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING));
  if ( concentration ) return caster.endConcentration(concentration);
  await extinguishLights(item);
  const ids = (carrier?.effects ?? []).filter(e => originItemOf(e) === item).map(e => e.id);
  if ( ids.length ) await carrier.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/**
 * §287 : Ténèbres — « si une partie de la zone recouvre une Lumière vive ou faible créée par un sort de niveau 2 ou inférieur, ce sort
 * est dissipé ». Les lumières de sort de la scène : un token qui brille d'un effet de sort (Lueurs féeriques, Lame de feu, Lumière
 * tenue, Rayon de soleil…), un objet lumineux invoqué (Lumière, Flamme éternelle), une zone de lumière ; recouvertes quand les
 * cercles se touchent (`dispelledBy`). Rend les sorts dissipés : `{ item: nom, token }` (le token qui brillait, pour le retour).
 */
async function dispelLights(region, center, radius, maxLevel) {
  const scene = region.parent;
  const px = r => (r / scene.grid.distance) * scene.grid.size;
  const sources = [];
  for ( const token of scene.tokens ) {
    const c = { x: token.x + ((token.width * scene.grid.sizeX) / 2), y: token.y + ((token.height * scene.grid.sizeY) / 2) };
    const lit = px(Math.max(Number(token.light?.dim) || 0, Number(token.light?.bright) || 0));
    if ( !(lit > 0) ) continue;
    const summoned = summonItemOf(token);
    if ( summoned && (lightRuleOf(summoned)?.on === "summon") ) {
      sources.push({ id: `token:${token.id}`, x: c.x, y: c.y, radius: lit, level: spellLevelOf(null, summoned), item: summoned, carrier: null, token: null });
    }
    for ( const effect of token.actor?.effects ?? [] ) {
      if ( effect.disabled ) continue;
      const lightOf = effect.getFlag(MODULE_ID, "lightOf");
      const item = lightOf ? fromUuidSync(lightOf, { strict: false }) : originItemOf(effect);
      if ( (item?.type !== "spell") || (!lightOf && !["effect", "caster"].includes(lightRuleOf(item)?.on)) ) continue;
      sources.push({ id: `effect:${effect.uuid}`, x: c.x, y: c.y, radius: lit, level: spellLevelOf(effect, item), item, carrier: token.actor, token });
    }
  }
  for ( const other of scene.regions ) {
    if ( other === region ) continue;
    const found = areaRuleOf(other);
    const oc = (found && !found.rule.darkness) ? regionCenter(other) : null;
    if ( !oc ) continue;
    const dim = Number.isFinite(found.rule.dim) ? toGridUnits(found.rule.dim, found.rule.units, scene.grid) : regionRadius(other);
    sources.push({ id: `region:${other.id}`, x: oc.x, y: oc.y, radius: px(dim), level: spellLevelOf(other, found.activity?.item),
      item: found.activity?.item ?? null, carrier: null, region: other });
  }
  const ids = new Set(dispelledBy({ x: center.x, y: center.y, radius: px(radius) }, maxLevel, sources.filter(s => Number.isFinite(s.level))));
  // Un sort qui éclaire plusieurs créatures (Lueurs féeriques) ne prend fin qu'une fois.
  const ended = new Map();
  for ( const source of sources.filter(s => ids.has(s.id)) ) {
    if ( !source.item || ended.has(source.item.uuid) ) continue;
    ended.set(source.item.uuid, { item: source.item.name, token: source.token ?? null });
    if ( source.region && !source.item.actor ) { await scene.deleteEmbeddedDocuments("Region", [source.region.id]); continue; }
    await endLightSpell(source.item, source.carrier);
  }
  return [...ended.values()];
}

/**
 * §287 : Rayon de soleil — « un point de rayonnement éclatant brille au-dessus de vous » tant que le sort dure : à l'activité de la
 * règle (`on: "caster"`, `activity`), un effet lumineux sur le lanceur, rattaché à sa concentration (`flags.dnd5e.dependents` : dnd5e
 * le retire avec elle, documents/active-effect.mjs:1105). Rien s'il brille déjà de ce sort (« Create New Sunbeam »).
 * @param {Activity} activity
 * @param {ActiveEffect|null} concentration  La concentration ouverte par l'utilisation.
 */
export async function lightCasterFor(activity, concentration=null) {
  const item = activity?.item;
  const rule = lightRuleOf(item);
  if ( (rule?.on !== "caster") || (rule.activity && (rule.activity !== activity.id)) ) return null;
  const actor = activity.actor;
  if ( !actor || actor.effects.some(e => e.getFlag(MODULE_ID, "lightOf") === item.uuid) ) return null;
  const grid = canvas?.scene?.grid ?? game.scenes.active?.grid;
  const radius = v => (Number.isFinite(v) && grid) ? toGridUnits(v, rule.units, grid) : (v ?? 0);
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name, img: item.img, origin: item.uuid, type: "base", duration: durationOf(item),
    system: { changes: tokenLightChanges({ bright: radius(rule.bright), dim: radius(rule.dim), color: rule.color ?? null, animation: rule.animation ?? null }) },
    flags: { [MODULE_ID]: { lightOf: item.uuid }, dnd5e: { spellLevel: item.system.level } }
  }]);
  if ( effect && concentration ) {
    await concentration.setFlag("dnd5e", "dependents", [...(concentration.getFlag("dnd5e", "dependents") ?? []), { uuid: effect.uuid }]);
  }
  return effect ?? null;
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

/**
 * Vision simulée (SPEC §14.1, P1) : « CE token voit-il CE token ? », sur n'importe quel client,
 * pour n'importe quelle paire, sans rien changer à ce qui est affiché.
 *
 * `canvas.visibility.testVisibility` répond pour les sources de vision ACTIVES du client (ses
 * tokens contrôlés). Ici, chaque observateur reçoit une source de vision JETABLE, non rattachée
 * au canevas — exactement ce que le cœur fait pour le brouillard partagé
 * (client/canvas/groups/visibility.mjs:668-690 : `_createSharedFogVisionSource`, états d'aveuglement
 * copiés, `initialize(_getVisionSourceData())`, mémoïsée par `_visionSourceVersion`). Puis on
 * rejoue la boucle de `testVisibility` (visibility.mjs:843-903) pour cette seule source : lumières
 * qui donnent la vue, vue de base, perception de la lumière, modes spéciaux (vision aveugle…).
 * Les modes de détection jugent déjà Invisible et Aveuglé par les sens (detection-mode.mjs:106-130).
 *
 * Positions : celles VALIDÉES (`_source`, foundry-core-notes/v14-migration.md), jamais la position
 * visuelle — l'origine de la vision comme les points de test de la cible.
 *
 * Repli pour les PNJ sans vue activée sur le token (la plupart des monstres du MM) : dnd5e 6
 * projette les sens de la fiche sur `sight.range` et les modes spéciaux (documents/token.mjs:74-131,
 * réglage `senseVisionSync`), mais n'active pas la vue ; le cœur n'ajoute alors ni vue de base ni
 * perception de la lumière (documents/token.mjs, _prepareDetectionModes). On les ajoute ici, comme
 * si la vue était activée : une créature sans vision configurée voit comme sa fiche le dit.
 *
 * Mémoïsation : une source par observateur, revue quand sa version de vision, sa position ou ses
 * états d'aveuglement changent ; tout est jeté quand murs, lumières ou scène changent
 * (runtime/vision.mjs), et détruit au démontage du canevas.
 */

import { committedPosition, distanceBetween } from "./turn.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { readUnitFactors } from "./units.mjs";
import { convertLength } from "../core/units.mjs";
import { sensesThrough, DEVILS_SIGHT } from "../core/light.mjs";
import { revealedInvisible } from "./facts.mjs";

const SOURCE_PREFIX = "dnd5e-combat";

/** Ce que ce fichier demande au cœur, contrôlé une fois à `ready` (SPEC §13.3 : API fragiles isolées). */
export function checkVisionApi() {
  const missing = [];
  const Token = foundry.canvas.placeables.Token;
  if ( !CONFIG.Canvas?.visionSourceClass ) missing.push("CONFIG.Canvas.visionSourceClass");
  if ( typeof Token.prototype._getVisionSourceData !== "function" ) missing.push("Token#_getVisionSourceData");
  if ( typeof Token.prototype._getVisionBlindedStates !== "function" ) missing.push("Token#_getVisionBlindedStates");
  if ( typeof foundry.documents.TokenDocument.prototype.getVisibilityTestPoints !== "function" ) missing.push("TokenDocument#getVisibilityTestPoints");
  if ( typeof foundry.canvas.perception.DetectionMode.prototype.testVisibility !== "function" ) missing.push("DetectionMode#testVisibility");
  return missing;
}

/** Vision en service : l'API du cœur est là (contrôle à `ready`) et le réglage de monde le veut. */
let available = false;
export function setVisionAvailable(value) { available = !!value; }
export function isVisionAvailable() { return available; }

/* -------------------------------------------- */
/*  Sources jetables                            */
/* -------------------------------------------- */

const sources = new Map();   // token id → { source, key }
let generation = 0;          // murs, lumières, scène : tout est à refaire

/** À appeler quand l'environnement change (murs, lumières, scène, acteurs). */
export function invalidateVision() {
  generation++;
}

/** Au démontage du canevas : les sources sont détruites, rien ne survit. */
export function disposeVision() {
  for ( const { source } of sources.values() ) source.destroy?.();
  sources.clear();
  generation++;
}

function blindedStates(token) {
  return token._getVisionBlindedStates();
}

function sourceKey(doc, token, pos, blinded) {
  return `${generation}|${token._visionSourceVersion ?? 0}|${pos.x},${pos.y},${pos.elevation}|${blinded.blind ? 1 : 0}${blinded.burrow ? 1 : 0}|${doc.sight.range}|${doc.sight.angle}|${doc.rotation}`;
}

/** La source de vision de cet observateur, à sa position validée. null si le token n'est pas dessiné. */
function sourceFor(doc) {
  const token = doc.object;
  if ( !token || token.destroyed ) return null;
  const pos = committedPosition(doc);
  const blinded = blindedStates(token);
  const key = sourceKey(doc, token, pos, blinded);
  let entry = sources.get(doc.id);
  if ( entry?.key === key ) return entry.source;
  entry?.source.destroy?.();
  const source = new CONFIG.Canvas.visionSourceClass({ sourceId: `${SOURCE_PREFIX}.${doc.id}`, object: token });
  for ( const state in blinded ) source.blinded[state] = blinded[state];
  const data = token._getVisionSourceData();
  Object.assign(data, doc.getVisionOrigin(pos));   // position validée, pas visuelle
  // Repli sans vue activée (voir detectionModesOf) : le cœur donne alors `lightRadius: 0` (Token#lightPerceptionRange,
  // placeables/token.mjs:772-775, faute de mode lightPerception sur le document) et le polygone de lumière de la
  // source est vide — un humain sans vision dans le noir ne voyait rien, même en pleine lumière (vu le 2026-09-24,
  // Mage du MM). null → la portée maximale de la scène (point-vision-source.mjs:211), bornée par les murs.
  if ( !doc.sight.enabled && !(data.lightRadius > 0) ) data.lightRadius = null;
  source.initialize(data);
  sources.set(doc.id, { source, key });
  return source;
}

/**
 * Les modes de détection de l'observateur, vue de base et perception de la lumière comprises même
 * sans vue activée. Normalisés comme le fait `TokenDocument#_prepareDetectionModes` (`enabled`
 * vrai par défaut, `range` null = illimité) : lus sur le document, un `range: null` traverse
 * jusqu'au test de portée du cœur, qui le prend pour « hors de portée » (`null <= 0`). Vu en jeu.
 */
function detectionModesOf(doc) {
  const modes = {};
  for ( const [id, mode] of Object.entries(doc.detectionModes ?? {}) ) {
    modes[id] = { ...mode, enabled: mode.enabled ?? true, range: (mode.range === null || mode.range === undefined) ? Infinity : mode.range };
  }
  if ( !doc.sight.enabled ) {
    modes.lightPerception ??= { enabled: true, range: Infinity };
    modes.basicSight ??= { enabled: true, range: doc.sight.range };
  }
  return modes;
}

/** Les points de test d'une cible à sa position validée, dans la forme attendue par les modes de détection. */
function testsFor(target) {
  const pos = committedPosition(target);
  const level = canvas.scene.levels?.get?.(target.level) ?? canvas.level;
  const tests = target.getVisibilityTestPoints(pos).map(point => ({ point, level, los: new Map() }));
  return { object: revealedInvisible(target.actor) ? unveiled(target.object) : target.object, level, tests };
}

/**
 * §16.36 : la cible telle que la voient les modes de détection quand elle « ne peut pas bénéficier de l'état Invisible »
 * (Poussière d'étoile, Lueurs féeriques). Chaque mode du cœur refuse une cible invisible dans son `_canDetect`
 * (detection-mode.mjs:118-121, detection-modes/darkvision.mjs:20-24…), par `target.document.hasStatusEffect` ; on lui présente
 * une vue du token dont le document ne porte pas Invisible — même prototype (`instanceof Token` tient), rien n'est modifié.
 */
function unveiled(token) {
  if ( !token ) return token;
  const invisible = CONFIG.specialStatusEffects.INVISIBLE;
  const doc = token.document;
  const view = Object.create(doc, { hasStatusEffect: { value: id => (id !== invisible) && doc.hasStatusEffect(id) } });
  return Object.create(token, { document: { value: view } });
}

/* -------------------------------------------- */

/**
 * L'observateur voit-il la cible ? Vision, lumière, murs, modes spéciaux, Invisible et Aveuglé
 * compris, aux positions validées.
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @returns {boolean|null}  null : impossible à dire ici (canevas absent, token non dessiné).
 */
export function canSee(observer, target) {
  if ( !canvas?.ready || !observer || !target ) return null;
  if ( observer === target ) return true;
  if ( !target.object || target.hidden ) return false;   // un token caché par le MJ est hors jeu pour tout le monde
  const source = sourceFor(observer);
  if ( !source ) return null;
  const config = testsFor(target);

  // §16.24 et §16.31 : une zone qui bloque la vue (Nappe de brouillard, Ténèbres) entre les deux, ou autour de l'un
  // d'eux : la vue ne passe pas — seuls jugent les sens qui ne voient pas, et, dans des ténèbres, la vision véritable et
  // la Vision du diable.
  const blocked = blockedBetween(observer, target);
  if ( blocked.fog || blocked.darkness ) return seesThroughBlock(observer, target, source, config, blocked);

  // Lumières qui donnent la vue (le cœur les teste en premier, pour tout le monde).
  for ( const light of canvas.effects.lightSources ) {
    if ( !light.data.vision || !light.active ) continue;
    if ( light.testVisibility(config) === true ) return true;
  }

  const modes = CONFIG.Canvas.detectionModes;
  const own = detectionModesOf(observer);
  if ( !source.isBlinded ) {
    for ( const id of ["basicSight", "lightPerception"] ) {
      const mode = own[id];
      if ( mode && (modes[id]?.testVisibility(source, mode, config) === true) ) return true;
    }
  }
  for ( const [id, mode] of Object.entries(own) ) {
    if ( (id === "basicSight") || (id === "lightPerception") ) continue;
    if ( modes[id]?.testVisibility(source, mode, config) === true ) return true;
  }
  return false;
}

/**
 * Les régions de la scène qui bloquent la vue : brume (`obscures`, §16.24) ou ténèbres magiques (`light.darkness`,
 * §16.31), posées par l'activité d'un item (`flags.dnd5e.activity`).
 * @returns {Array<{region: RegionDocument, kind: "fog"|"darkness"}>}
 */
export function blockingRegions(scene) {
  const out = [];
  for ( const region of scene?.regions ?? [] ) {
    const uuid = region.getFlag?.("dnd5e", "activity");
    const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    if ( !activity?.item ) continue;
    const entry = contentOf(activity.item).entry;
    if ( entry?.obscures === true ) out.push({ region, kind: "fog" });
    else if ( entry?.light?.darkness === true ) out.push({ region, kind: "darkness" });
  }
  return out;
}

/** Le centre d'un token à sa position validée, à hauteur de ses pieds. */
function centerOf(doc) {
  const grid = doc.parent.grid;
  const p = committedPosition(doc);
  return { x: p.x + ((p.width ?? 1) * grid.sizeX) / 2, y: p.y + ((p.height ?? 1) * grid.sizeY) / 2, elevation: p.elevation ?? 0 };
}

/**
 * Ce qui bloque la vue le long d'un trait (échantillonné tous les demi-carreaux), extrémités comprises : une brume, des
 * ténèbres, les deux ou rien.
 * @returns {{fog: boolean, darkness: boolean}}
 */
function blockedAlong(scene, from, to) {
  const out = { fog: false, darkness: false };
  const regions = blockingRegions(scene);
  if ( !regions.length ) return out;
  const grid = scene.grid;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (grid.size / 2)));
  for ( let k = 0; k <= steps; k++ ) {
    const t = k / steps;
    const point = { x: from.x + ((to.x - from.x) * t), y: from.y + ((to.y - from.y) * t),
      elevation: (from.elevation ?? 0) + (((to.elevation ?? 0) - (from.elevation ?? 0)) * t) };
    for ( const { region, kind } of regions ) if ( !out[kind] && region.testPoint?.(point) ) out[kind] = true;
    if ( out.fog && out.darkness ) break;
  }
  return out;
}

/**
 * Une zone qui bloque la vue coupe-t-elle la vue entre deux tokens — l'un d'eux dedans, ou le trait qui les relie la
 * traversant ? Positions validées. `{ fog, darkness }`.
 */
export function blockedBetween(a, b) {
  return blockedAlong(a.parent, centerOf(a), centerOf(b));
}

/** Un rayon lu dans l'unité d'une règle, ramené à celle de la grille (la valeur telle quelle si l'unité est inconnue). */
function toGridUnits(value, units, grid) {
  try { return convertLength(value, units, grid.units, readUnitFactors()); }
  catch { return value; }
}

/** La portée de la Vision du diable de l'observateur, unité de la grille, ou 0. */
export function devilsSightRange(observer) {
  const items = observer.actor?.items ?? [];
  if ( !items.some?.(i => identifierOf(i).id === DEVILS_SIGHT.identifier) ) return 0;
  return toGridUnits(DEVILS_SIGHT.range, DEVILS_SIGHT.units, observer.parent.grid);
}

/**
 * À travers une zone qui bloque la vue, l'observateur perçoit-il la cible ? Les sens qui percent (core/light.mjs,
 * `sensesThrough`) se jugent ici à la portée et aux murs seuls : dans des ténèbres, le cœur tient la source pour aveuglée
 * (`blinded.darkness`, point-vision-source.mjs:186-190) et ses propres modes échoueraient. La perception des vibrations,
 * qui ignore les murs et l'aveuglement, reste jugée par le cœur. La Vision du diable « voit normalement » : pas un
 * Invisible.
 */
function seesThroughBlock(observer, target, source, config, blocked) {
  const own = detectionModesOf(observer);
  const distance = distanceBetween(observer, target).value;
  const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? centerOf(observer);
  const inSight = () => hasLineOfSight(eye, target, canvas.scene.levels?.get?.(observer.level));
  for ( const id of sensesThrough(blocked) ) {
    const mode = own[id];
    if ( !mode || (mode.enabled === false) ) continue;
    if ( id === "feelTremor" ) {
      if ( CONFIG.Canvas.detectionModes[id]?.testVisibility(source, mode, config) === true ) return true;
      continue;
    }
    if ( (distance <= mode.range) && inSight() ) return true;
  }
  if ( blocked.darkness && !blocked.fog ) {
    const range = devilsSightRange(observer);
    const invisible = target.hasStatusEffect?.(CONFIG.specialStatusEffects.INVISIBLE) && !revealedInvisible(target.actor);
    const blind = observer.hasStatusEffect?.(CONFIG.specialStatusEffects.BLIND);
    if ( range && !invisible && !blind && (distance <= range) && inSight() ) return true;
  }
  return false;
}

/**
 * L'observateur voit-il ce point (« un espace inoccupé que vous pouvez voir », Pas brumeux) ? Même test que `canSee`
 * — lumières, vue, perception de la lumière, modes spéciaux, murs —, sur le seul point, au niveau de l'observateur.
 * @param {TokenDocument} observer
 * @param {{x: number, y: number, elevation?: number}} point
 * @returns {boolean|null}  null : impossible à dire (vision hors service, canevas absent).
 */
export function canSeePoint(observer, point) {
  if ( !available || !canvas?.ready || !observer ) return null;
  const source = sourceFor(observer);
  if ( !source ) return null;
  const level = canvas.scene.levels?.get?.(observer.level) ?? canvas.level;
  const config = { object: null, level, tests: [{ point: { x: point.x, y: point.y, elevation: point.elevation ?? 0 }, level, los: new Map() }] };
  // §16.31 : un point dans une brume ou des ténèbres, ou vu à travers, ne se voit pas — sauf par les sens qui les percent.
  const blocked = blockedAlong(observer.parent, centerOf(observer), point);
  if ( blocked.fog || blocked.darkness ) {
    const own = detectionModesOf(observer);
    const grid = observer.parent.grid;
    const from = centerOf(observer);
    const distance = grid.measurePath([from, { x: point.x, y: point.y, elevation: point.elevation ?? from.elevation }]).distance;
    const ranges = sensesThrough(blocked).filter(id => (id !== "feelTremor") && own[id] && (own[id].enabled !== false))
      .map(id => own[id].range);
    if ( blocked.darkness && !blocked.fog ) ranges.push(devilsSightRange(observer));
    if ( !ranges.some(r => r && (distance <= r)) ) return false;
    const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? from;
    return CONFIG.Canvas.polygonBackends.sight.testCollision(eye, { x: point.x, y: point.y, elevation: point.elevation ?? eye.elevation },
      { type: "sight", mode: "any", level: level ?? undefined }) !== true;
  }
  for ( const light of canvas.effects.lightSources ) {
    if ( !light.data.vision || !light.active ) continue;
    if ( light.testVisibility(config) === true ) return true;
  }
  const modes = CONFIG.Canvas.detectionModes;
  const own = detectionModesOf(observer);
  if ( source.isBlinded ) return Object.entries(own).some(([id, mode]) => !["basicSight", "lightPerception"].includes(id)
    && (modes[id]?.testVisibility(source, mode, config) === true));
  return Object.entries(own).some(([id, mode]) => modes[id]?.testVisibility(source, mode, config) === true);
}

/**
 * Les deux faits d'une attaque, ou null si l'un des deux ne peut pas être établi.
 * @returns {{attackerSees: boolean, targetSees: boolean}|null}
 */
export function visionFacts(attacker, target) {
  const attackerSees = canSee(attacker, target);
  const targetSees = canSee(target, attacker);
  if ( (attackerSees === null) || (targetSees === null) ) return null;
  return { attackerSees, targetSees };
}

/* -------------------------------------------- */
/*  Depuis un acteur, depuis un point           */
/* -------------------------------------------- */

/** Le token d'un acteur sur la scène affichée : le sien (non lié), sinon le premier de ses tokens. */
export function tokenOf(actor) {
  if ( !actor ) return null;
  if ( actor.token?.parent === canvas?.scene ) return actor.token;
  return actor.getActiveTokens?.(true, true)?.[0] ?? null;
}

/**
 * Un acteur en voit-il un autre ? Pour les réactions (« que vous pouvez voir ») et Effrayé
 * (« tant que la source est en vue »). null : impossible à dire (vision hors service, pas de token).
 */
export function seesBetween(observerActor, targetActor) {
  if ( !available ) return null;
  return canSee(tokenOf(observerActor), tokenOf(targetActor));
}

/**
 * Depuis ce point, a-t-on la LIGNE DE VUE sur la cible ? Murs de type `sight` seulement — ni
 * lumière, ni portée des sens : c'est le test bon marché de l'approche (« une case d'où l'on voit
 * la cible », SPEC §14.1), joué sur beaucoup de cases candidates par le chercheur de chemin.
 * @param {{x: number, y: number, elevation?: number}} point
 * @param {TokenDocument} target
 * @param {Level} [level]  Niveau dont on prend les murs (celui de l'observateur) ; à défaut, le niveau affiché.
 */
export function hasLineOfSight(point, target, level=undefined) {
  if ( !canvas?.ready || !target?.object ) return true;
  const backend = CONFIG.Canvas.polygonBackends.sight;
  const origin = { x: point.x, y: point.y, elevation: point.elevation ?? committedPosition(target).elevation ?? 0 };
  // P2 : les murs du niveau de l'observateur (sans `level`, le cœur prend le niveau affiché, source-polygon.mjs:187).
  const config = { type: "sight", mode: "any", level: level ?? undefined };
  // P2 : un plancher ou un plafond (Surface `sight`) coupe la ligne de vue comme un mur — entre la hauteur
  // du point et celle des yeux de la cible (Scene#testSurfaceCollision, un lancer de rayon 3D).
  const scene = target.parent;
  const surfaces = typeof scene.testSurfaceCollision === "function";
  return target.getVisibilityTestPoints(committedPosition(target)).some(p => {
    const end = { x: p.x, y: p.y, elevation: p.elevation ?? origin.elevation };
    if ( backend.testCollision(origin, end, config) === true ) return false;
    return !(surfaces && (scene.testSurfaceCollision(origin, end, { type: "sight", mode: "any" }) === true));
  });
}

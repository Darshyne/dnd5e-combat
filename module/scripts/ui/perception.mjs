/**
 * Ce que chaque joueur voit à l'écran (§62), aligné sur la vision simulée des règles (adapter/vision.mjs) :
 *  - une zone qui bloque la vue (Nappe de brouillard, Ténèbres : `blockedBetween`) cache, pour les modes de détection fondés sur
 *    la vue, ce qui est dedans ou derrière — sauf pour les sens qui la percent (`sensesThrough`) ;
 *  - une créature qu'on ne voit pas mais qu'on ENTEND (invisible, dans la brume ; ni cachée, ni morte, pas derrière un mur qui
 *    arrête le son, observateur non Assourdi : adapter/hearing.mjs) s'affiche avec un contour ondulant, comme la perception des
 *    vibrations du cœur : on sait où elle est, on peut la viser (au désavantage).
 *
 * Par les points d'extension du cœur : chaque mode de détection de `CONFIG.Canvas.detectionModes` est remplacé, à `setup`, par
 * une sous-classe de sa propre classe (même id, mêmes données) — rien n'est patché. La vue de base et la perception de la lumière
 * sont testées pour chaque source avant les modes spéciaux (canvas/groups/visibility.mjs, `testVisibility`) : l'ouïe passe par
 * la perception de la lumière, en dernier recours, après avoir laissé les modes spéciaux de l'observateur répondre. Les sources
 * jetables de la vision simulée (`dnd5e-combat.…`) n'entendent pas : pour les règles, entendre n'est pas voir.
 *
 * Issue #42 :
 *  - les sens qui percent les ténèbres (vision aveugle, vision véritable) se jugent ici par leur portée et une ligne de vue SANS les bords
 *    des sources de ténèbres : le test du cœur les comptait, et rien ne se voyait dans des Ténèbres ;
 *  - un mode de détection « Vision du diable » (`devilsSight`), enregistré à `setup` et donné EN MÉMOIRE (rien n'est écrit) aux tokens
 *    dont l'acteur a l'invocation (`devils-sight`), à chaque mise en place des sources de vision (`initializeVisionSources`) : la cible
 *    à 120 ft s'affiche nette, comme vue normalement — la règle est celle de `canSee` (adapter/vision.mjs, `devilsSightSeesToken`) ;
 *  - l'ouïe d'un observateur Aveuglé passe par un mode spécial donné en mémoire (`dasHearing`) : le cœur saute la perception de la
 *    lumière d'une source aveuglée, et un personnage Aveuglé ne voyait plus ce qu'il entend ;
 *  - une créature entendue (contour) porte une petite oreille au-dessus de son token, et, au survol, « Entendu, pas vu » : de loin, le
 *    contour d'un token à anneau passait pour une créature vue. (L'anneau dynamique ne se retire pas côté client sans patcher le cœur.)
 */

import { MODULE_ID } from "../constants.mjs";
import { blockedBetween, isVisionAvailable, devilsSightRange, devilsSightSeesToken, senseReachesToken, asSeenBy, isSenseless } from "../adapter/vision.mjs";
import { canHear } from "../adapter/hearing.mjs";
import { sensesThrough, CORE_JUDGED, DEVILS_SIGHT, HEARING_MODE, grantInMemoryModes } from "../core/light.mjs";
import { route } from "../runtime/router.mjs";
import { theaterActive } from "../runtime/theater-state.mjs";
import { perceivesPlane } from "../adapter/plane.mjs";
import { loc } from "../runtime/shared.mjs";

const SIMULATED = `${MODULE_ID}.`;   // préfixe des sources de vision jetables (adapter/vision.mjs, SOURCE_PREFIX)
const SIGHT = 0;                      // DetectionMode.DETECTION_TYPES.SIGHT

let hearingFilter = null;
function filter() {
  return hearingFilter ??= foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
    outlineColor: [0.55, 0.8, 1, 1], knockout: true, wave: true
  });
}

/** Les deux documents d'un test : l'observateur (sa source de vision) et la cible, si c'est un token. */
function pair(visionSource, object) {
  const Token = foundry.canvas.placeables.Token;
  if ( !(object instanceof Token) ) return null;
  const observer = visionSource?.object?.document;
  return (observer && object.document) ? { observer, target: object.document } : null;
}

/**
 * Ce qu'une brume ou des ténèbres entre l'observateur et la cible font à ce mode : `"blocked"` (la vue ne passe pas), `"pierce"` (un sens
 * qui perce des ténèbres, jugé par le moteur : portée et ligne de vue sans les bords des ténèbres — issue #42), ou null (rien entre les
 * deux, ou le test du cœur suffit : les modes sans murs, `CORE_JUDGED` — vibrations, Sense All, Sense Invisibility ; un sens qui perce
 * une brume seule).
 */
function blockFor(id, visionSource, object) {
  if ( !isVisionAvailable() ) return null;
  const p = pair(visionSource, object);
  if ( !p ) return null;
  const blocked = blockedBetween(p.observer, p.target);
  if ( !blocked.fog && !blocked.darkness ) return null;
  if ( !(sensesThrough(blocked) ?? []).includes(id) ) return "blocked";
  return (CORE_JUDGED.includes(id) || !blocked.darkness) ? null : "pierce";
}

/** Un mode spécial de l'observateur (vision aveugle, voir l'invisible…) la détecte-t-il ? Il a priorité : son propre rendu. */
function specialDetects(visionSource, config) {
  const doc = visionSource.object.document;
  const modes = CONFIG.Canvas.detectionModes;
  return Object.entries(doc.detectionModes ?? {}).some(([id, mode]) => (id !== "basicSight") && (id !== "lightPerception")
    && (modes[id]?.testVisibility(visionSource, mode, config) === true));
}

/** On ne la voit pas, mais on l'entend : contour ondulant. */
function heard(visionSource, config) {
  if ( !isVisionAvailable() || String(visionSource?.sourceId ?? "").startsWith(SIMULATED) ) return false;
  const p = pair(visionSource, config.object);
  if ( !p || !canHear(p.observer, p.target) ) return false;
  if ( specialDetects(visionSource, config) ) return false;
  config.object.detectionFilter = filter();
  return true;
}

const reported = new Set();
/** Une erreur de la brume ou de l'ouïe, dite une fois (avec sa pile) : l'affichage retombe sur le cœur. */
function reportOnce(err) {
  const key = String(err?.message ?? err);
  if ( reported.has(key) ) return;
  reported.add(key);
  console.error(`${MODULE_ID} | perception (mist, hearing, plane): ${key}\n${err?.stack ?? ""}`);
}

/** §225 : la cible est-elle hors de portée de perception de l'observateur, d'un plan à l'autre (Éthéré) ? */
function offPlane(visionSource, object) {
  const p = pair(visionSource, object);
  return !!p && !perceivesPlane(p.observer, p.target);
}

/**
 * La sous-classe d'un mode de détection : aucun ne perçoit d'un plan à l'autre sans vue de l'Éthéré (§225) ; la vue s'arrête à la
 * brume ; la perception de la lumière entend en dernier recours.
 */
function extend(id, mode) {
  const Base = mode.constructor;
  const sight = mode.type === SIGHT;
  const listens = id === "lightPerception";
  const Extended = class extends Base {
    testVisibility(visionSource, tokenMode, config) {
      // §220 : Théâtre de l'esprit — le test du cœur seul.
      if ( theaterActive() ) return super.testVisibility(visionSource, tokenMode, config);
      try { if ( offPlane(visionSource, config.object) ) return false; }
      catch(err) { reportOnce(err); }
      // Réglage `unconsciousSenses` : un observateur Inconscient ne perçoit plus rien, par aucun mode.
      try { if ( isSenseless(visionSource?.object?.document) ) return false; }
      catch(err) { reportOnce(err); }
      // Ce que le moteur ajoute ne doit jamais casser l'affichage du cœur : une erreur → le test du cœur seul, et la pile une fois.
      let block = null;
      try { block = blockFor(id, visionSource, config.object); }
      catch(err) { reportOnce(err); }
      // Issue #42 : un sens qui perce des ténèbres (vision aveugle, vision véritable) — le test du cœur compte leurs bords comme des murs.
      if ( (block === "pierce") && (id !== DEVILS_SIGHT.mode) ) {
        if ( !tokenMode.enabled ) return false;
        try {
          const p = pair(visionSource, config.object);
          return !!p && senseReachesToken(p.observer, p.target, tokenMode.range, id);
        }
        catch(err) { reportOnce(err); }
      }
      if ( !sight && !listens ) return super.testVisibility(visionSource, tokenMode, config);
      // Issue #42 : un observateur qui voit l'Invisible (Détection de l'invisibilité) — la vue de base du cœur refuse toute cible Invisible
      // (detection-mode.mjs `_canDetect`) ; on lui présente la cible dévoilée, comme les règles (`asSeenBy`).
      const original = config;   // l'ouïe pose son filtre sur le vrai token, jamais sur la vue dévoilée
      if ( sight ) {
        try {
          const p = pair(visionSource, config.object);
          const seen = p ? asSeenBy(p.observer, config.object) : config.object;
          if ( seen !== config.object ) config = { ...config, object: seen };
        }
        catch(err) { reportOnce(err); }
      }
      const blocked = sight && (block === "blocked");
      if ( !blocked && super.testVisibility(visionSource, tokenMode, config) ) return true;
      if ( !listens || !tokenMode.enabled ) return false;
      try { return heard(visionSource, original); }
      catch(err) { reportOnce(err); return false; }
    }
  };
  Object.defineProperty(Extended, "name", { value: `${Base.name}${MODULE_ID.replace(/\W/g, "")}` });
  return new Extended(mode.toObject());
}

/**
 * Issue #42 : le mode de détection « Vision du diable ». Une vue (`SIGHT`) bornée par les murs, qui ne s'arrête pas aux ténèbres : son test
 * est celui des règles (`devilsSightSeesToken` : 120 ft, ligne de vue sans les bords des ténèbres, ni Invisible, ni Aveuglé, ni brume).
 * Sans filtre : la cible s'affiche nette, « vue normalement ». Pas proposé dans la configuration du token (donné par l'invocation).
 */
function devilsSightMode() {
  const DetectionMode = foundry.canvas.perception.DetectionMode;
  class DetectionModeDevilsSight extends DetectionMode {
    testVisibility(visionSource, mode, config) {
      if ( !mode?.enabled ) return false;
      const p = pair(visionSource, config.object);
      if ( !p ) return false;
      return devilsSightSeesToken(p.observer, p.target);
    }
  }
  return new DetectionModeDevilsSight({ id: DEVILS_SIGHT.mode, label: "DND5ECOMBAT.Vision.DevilsSight", tokenConfig: false,
    type: DetectionMode.DETECTION_TYPES.SIGHT, walls: true, angle: true });
}

/**
 * Issue #42 : le mode « Vision du diable » donné en mémoire aux tokens qui ont une source de vision et dont l'acteur a l'invocation — comme
 * dnd5e projette les sens de la fiche (documents/token.mjs `applySenseOverrides`), sans rien écrire. Les données préparées du token sont
 * refaites à chaque mise à jour ; le cœur rappelle ce hook à chaque mise en place des sources (groups/visibility.mjs:192).
 */
function grantModes(sources) {
  for ( const source of sources?.values?.() ?? [] ) grantOn(source.object?.document);
}

/**
 * Les modes en mémoire d'un token. Aussi rejoué sur TOUS les tokens de la scène à chaque rafraîchissement de la vue (`grantAll`,
 * `sightRefresh`) : un état posé ou retiré (Aveuglé : `Token#_onApplyStatusEffect` ne refait que la source de ce token,
 * placeables/token.mjs:4580), un acteur ou un token mis à jour refont les données préparées sans remettre en place toutes les sources —
 * ces modes disparaissaient jusqu'à la mise en place suivante (vu le 2026-11-08 : un Rôdeur Aveuglé à la main n'entendait rien).
 */
function grantOn(doc) {
  const modes = CONFIG.Canvas.detectionModes;
  if ( !doc?.detectionModes || !doc.sight?.enabled ) return false;
  blindIfSenseless(doc.object);
  // L'ouïe d'un Aveuglé en DERNIER (core/light.mjs `grantInMemoryModes`) : le cœur essaie les modes spéciaux dans l'ordre.
  return grantInMemoryModes(doc.detectionModes, {
    devilsSight: modes[DEVILS_SIGHT.mode] ? devilsSightRange(doc) : 0,
    hearing: !!modes[HEARING_MODE]
  });
}

/**
 * Issue #42, suite (Archibald, 0.281.0) : la préparation des données d'un token (`TokenDocument#reset`) refait `detectionModes` depuis la
 * source — les modes en mémoire disparaissent, et rien ne refait la vue avant le prochain `sightRefresh` (une cible qui bouge ne le
 * déclenche pas) : la cible dans les Ténèbres passait au contour de l'ouïe. Un effet qui vise le token (`token.…`, celui du joueur sur
 * `token.detectionModes.devilsSight.range`) fait refaire le token à CHAQUE mise à jour de l'acteur (`_onRelatedUpdate`,
 * documents/token.mjs:3810) et laissait `{ range }` sans `enabled`. Le hook de la mise à jour vient après cette préparation : on redonne
 * les modes aux tokens touchés, et, s'il en manquait, la vue se refait.
 */
function regrant(docs) {
  if ( !canvas?.ready ) return;
  let changed = false;
  for ( const doc of docs ) if ( doc?.parent === canvas.scene ) changed = grantOn(doc) || changed;
  if ( changed ) refreshVisibility();
}

function tokensOfActor(actor) {
  return actor?.getActiveTokens?.(false, true) ?? [];
}

/**
 * Réglage `unconsciousSenses` : la source de vision d'un Inconscient est aveuglée (`blinded.unconscious`, point-vision-source.mjs:172-182) —
 * son écran passe en mode « cécité », comme Aveuglé. Le cœur ne remet que ses propres clés (`blind`, `burrow`, placeables/token.mjs:936) :
 * la nôtre reste jusqu'au réveil ; changée, la source est refaite (elle seule).
 */
function blindIfSenseless(token) {
  const vision = token?.vision;
  if ( !vision?.blinded ) return;
  const want = isSenseless(token.document);
  if ( !!vision.blinded.unconscious === want ) return;
  vision.blinded.unconscious = want;
  token.initializeVisionSource();
}

function grantAll() {
  if ( !canvas?.ready ) return;
  for ( const token of canvas.tokens.placeables ) grantOn(token.document);
}

/**
 * Issue #42 : l'ouïe d'un observateur Aveuglé. Le cœur saute la vue de base et la perception de la lumière d'une source aveuglée
 * (groups/visibility.mjs, `if ( visionSource.isBlinded ) continue`) — or l'ouïe passe par la perception de la lumière (`heard`) : un
 * personnage Aveuglé ne voyait plus à l'écran les créatures qu'il entend. Ce mode spécial (SOUND, ni murs ni angle : `canHear` juge
 * murs de son, surdité, cible cachée ou morte), donné en mémoire à chaque token avec une source de vision, n'agit que pour une source
 * aveuglée et jamais pour les sources jetables des règles (entendre n'est pas voir) ; le cœur pose son filtre, le contour de l'ouïe.
 */
function hearingMode() {
  const DetectionMode = foundry.canvas.perception.DetectionMode;
  class DetectionModeHearing extends DetectionMode {
    static getDetectionFilter() { return filter(); }
    testVisibility(visionSource, mode, config) {
      if ( !mode?.enabled || !visionSource?.isBlinded || !isVisionAvailable() ) return false;
      if ( String(visionSource.sourceId ?? "").startsWith(SIMULATED) ) return false;
      const p = pair(visionSource, config.object);
      return !!p && canHear(p.observer, p.target);
    }
  }
  return new DetectionModeHearing({ id: HEARING_MODE, label: "DND5ECOMBAT.Vision.Ouie", tokenConfig: false,
    type: DetectionMode.DETECTION_TYPES.SOUND, walls: false, angle: false });
}

/** À `setup` : après le cœur et le système (dnd5e ajoute ses modes à `init`). */
function installModes() {
  const modes = CONFIG.Canvas.detectionModes;
  modes[DEVILS_SIGHT.mode] ??= devilsSightMode();
  modes[HEARING_MODE] ??= hearingMode();
  for ( const [id, mode] of Object.entries(modes) ) {
    const extended = mode ? extend(id, mode) : null;
    if ( extended ) modes[id] = extended;
  }
}

/** Ce qui change ce qu'on voit ou entend sans bouger un token : une brume posée ou levée, se cacher, être assourdi. */
function refreshVisibility() {
  if ( !canvas?.ready ) return;
  canvas.perception.update({ refreshVision: true });
  for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshVisibility: true });
}

export function registerPerception() {
  route("setup", installModes, { label: "perception: detection modes not installed" });
  route("initializeVisionSources", grantModes, { label: "perception: Devil's Sight or blind hearing not granted" });
  // À chaque rafraîchissement de la vue : `restrictVisibility` demande `refreshVisibility` à chaque token puis appelle `sightRefresh`
  // (groups/visibility.mjs:809-828) — les tokens n'appliquent ce drapeau qu'après. Les modes en mémoire sont donc là au moment du test,
  // quoi qu'ait refait le cœur entre-temps (données préparées refaites après un état, un acteur, un token mis à jour).
  route("sightRefresh", grantAll, { label: "perception: Devil's Sight or blind hearing not granted again" });
  const again = { label: "perception: Devil's Sight or blind hearing not granted after an update" };
  route("updateActor", actor => regrant(tokensOfActor(actor)), again);
  route("updateToken", doc => regrant([doc]), again);
  for ( const hook of ["createItem", "updateItem", "deleteItem"] ) route(hook, item => regrant(tokensOfActor(item?.parent)), again);
  registerHeardMarks();
  const refresh = { label: "perception: display not refreshed" };
  for ( const hook of ["createRegion", "updateRegion", "deleteRegion", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, refreshVisibility, refresh);
  }
}

/* -------------------------------------------- */
/*  Issue #42 : l'oreille des créatures entendues */
/* -------------------------------------------- */

/** L'oreille de Font Awesome 6 (`ear-listen`). */
const EAR = "\uf2a2";
const marks = new Map();   // id du token → { root, label, r }
let markLayer = null;

function markLayerOf() {
  if ( !markLayer || markLayer.destroyed || (markLayer.parent !== canvas.interface) ) {
    markLayer = canvas.interface.addChild(new PIXI.Container());
    markLayer.eventMode = "none";
    markLayer.zIndex = 1040;   // au-dessus du calque des tokens (200), sous le sablier (1050, ui/awaiting.mjs)
  }
  return markLayer;
}

/** Une pastille sombre au filet bleu pâle (la couleur du contour de l'ouïe), une oreille ; au survol, « Entendu, pas vu ». */
function buildMark() {
  const r = Math.max(9, canvas.grid.size * 0.13);
  const root = new PIXI.Container();
  const back = new PIXI.Graphics().beginFill(0x000000, 0.6).drawCircle(0, 0, r).endFill()
    .lineStyle(2, 0x8ccdff, 0.95).drawCircle(0, 0, r);
  const ear = new PIXI.Text(EAR, {
    fontFamily: ["Font Awesome 6 Pro", "Font Awesome 6 Free", "FontAwesome"], fontWeight: "900", fontSize: Math.round(r * 1.1),
    fill: 0xd6ecff, stroke: 0x000000, strokeThickness: 2
  });
  ear.anchor.set(0.5);
  const label = new PIXI.Text(loc("Vision.Entendu"), {
    fontFamily: "Signika", fontSize: Math.round(Math.max(12, r * 1.05)), fill: 0xffffff, stroke: 0x000000, strokeThickness: 4,
    align: "left"
  });
  label.anchor.set(0, 0.5);
  label.position.set(r + 4, 0);
  label.visible = false;
  root.addChild(back, ear, label);
  return { root, label, r };
}

function dropMark(id) {
  const mark = marks.get(id);
  if ( !mark ) return;
  marks.delete(id);
  if ( !mark.root.destroyed ) mark.root.destroy({ children: true });
}

/** Le token est-il affiché parce qu'on l'entend (le contour de l'ouïe), sur ce client ? */
function isHeard(token) {
  return !!token && !token.destroyed && (token.isVisible === true) && !!hearingFilter && (token.detectionFilter === hearingFilter);
}

function refreshMark(token) {
  if ( !canvas?.ready || !token?.document ) return;
  if ( !isHeard(token) ) { dropMark(token.id); return; }
  let mark = marks.get(token.id);
  if ( !mark ) marks.set(token.id, mark = buildMark());
  if ( mark.root.parent !== markLayerOf() ) markLayerOf().addChild(mark.root);
  // Coin haut gauche du token (le sablier prend le haut droit, les minuteries le dessus).
  mark.root.position.set(token.x + (mark.r * 0.6), token.y + (mark.r * 0.6));
  mark.label.visible = !!token.hover;
}

function clearMarks() {
  for ( const id of [...marks.keys()] ) dropMark(id);
  markLayer = null;
}

/** Issue #42 : chaque client pose l'oreille sur les tokens qu'il entend, à leur position affichée ; rien n'est écrit. */
function registerHeardMarks() {
  const opts = { label: "perception: hearing mark not drawn" };
  route("refreshToken", token => refreshMark(token), opts);
  route("hoverToken", token => refreshMark(token), opts);
  route("destroyToken", token => dropMark(token.id), opts);
  route("canvasTearDown", clearMarks, opts);
}

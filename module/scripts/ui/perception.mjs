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
 */

import { MODULE_ID } from "../constants.mjs";
import { blockedBetween, isVisionAvailable } from "../adapter/vision.mjs";
import { canHear } from "../adapter/hearing.mjs";
import { sensesThrough } from "../core/light.mjs";
import { route } from "../runtime/router.mjs";

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

/** La vue de ce mode est-elle coupée par une brume ou des ténèbres entre l'observateur et la cible ? */
function blockedFor(id, visionSource, object) {
  if ( !isVisionAvailable() ) return false;
  const p = pair(visionSource, object);
  if ( !p ) return false;
  const blocked = blockedBetween(p.observer, p.target);
  if ( !blocked.fog && !blocked.darkness ) return false;
  return !(sensesThrough(blocked) ?? []).includes(id);
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
  console.error(`${MODULE_ID} | perception (brume, ouïe) : ${key}\n${err?.stack ?? ""}`);
}

/** La sous-classe d'un mode de détection : la vue s'arrête à la brume ; la perception de la lumière entend en dernier recours. */
function extend(id, mode) {
  const Base = mode.constructor;
  const sight = mode.type === SIGHT;
  const listens = id === "lightPerception";
  if ( !sight && !listens ) return null;
  const Extended = class extends Base {
    testVisibility(visionSource, tokenMode, config) {
      // Ce que le moteur ajoute ne doit jamais casser l'affichage du cœur : une erreur → le test du cœur seul, et la pile une fois.
      let blocked = false;
      try { blocked = sight && blockedFor(id, visionSource, config.object); }
      catch(err) { reportOnce(err); }
      if ( !blocked && super.testVisibility(visionSource, tokenMode, config) ) return true;
      if ( !listens || !tokenMode.enabled ) return false;
      try { return heard(visionSource, config); }
      catch(err) { reportOnce(err); return false; }
    }
  };
  Object.defineProperty(Extended, "name", { value: `${Base.name}${MODULE_ID.replace(/\W/g, "")}` });
  return new Extended(mode.toObject());
}

/** À `setup` : après le cœur et le système (dnd5e ajoute ses modes à `init`). */
function installModes() {
  const modes = CONFIG.Canvas.detectionModes;
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
  route("setup", installModes, { label: "perception : modes de détection non installés" });
  const refresh = { label: "perception : affichage non rafraîchi" };
  for ( const hook of ["createRegion", "updateRegion", "deleteRegion", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, refreshVisibility, refresh);
  }
}

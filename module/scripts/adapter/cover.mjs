/**
 * L'abri lu dans Foundry pour le cœur (core/cover.mjs) : espaces des tokens aux positions
 * VALIDÉES, murs par le lancer de rayon natif de type `move` (un obstacle physique donne l'abri —
 * une fenêtre bloque le déplacement, pas la vue ; un brouillard, l'inverse ; une porte ouverte ne
 * bloque rien : c'est le polygone du cœur qui le sait, `source-polygon.mjs:326`), corps des
 * autres créatures dessinées, non cachées — un mort ne couvre que s'il est Grand ou plus (core/cover.mjs, `bodyGivesCover`).
 *
 * P2 (§14.2) : les rayons sont tirés **dans le niveau de l'attaquant** (`level` du polygone —
 * sans lui le cœur prend le niveau affiché, source-polygon.mjs:187) et, en plus des murs, contre
 * les **surfaces** (planchers, plafonds : régions à comportement `defineSurface`), par le lancer
 * de rayon 3D de la scène (`Scene#testSurfaceCollision`, client/documents/scene.mjs:810) entre la
 * hauteur des yeux de l'attaquant et celle de la cible (origine de déplacement du cœur :
 * pieds + moitié de la hauteur). Un plancher plein entre deux créatures est un abri total.
 *
 * Calculé sur le MJ actif, au moment du verdict (runtime/engine.mjs, enrich) : une paire par cible.
 * Un état d'abri posé à la main par le MJ (`coverHalf`…) l'emporte : dnd5e l'a déjà compté dans
 * la CA, on ne recalcule pas.
 */

import { MODULE_ID } from "../constants.mjs";
import { coverBetween, bodyGivesCover } from "../core/cover.mjs";
import { committedPosition } from "./turn.mjs";
import { isDeadActor } from "./death.mjs";
import { isObjectToken } from "./bodies.mjs";

const COVER_STATUSES = ["coverHalf", "coverThreeQuarters", "coverTotal"];
/** Retrait des coins, en fraction d'une case : une ligne qui longe un mur ne compte pas. */
const INSET_FRACTION = 0.1;

let available = false;
export function setCoverAvailable(value) { available = !!value; }
export function isCoverAvailable() { return available; }

/** Ce que ce fichier demande au cœur, contrôlé une fois à `ready`. */
export function checkCoverApi() {
  return (typeof CONFIG.Canvas?.polygonBackends?.move?.testCollision === "function") ? [] : ["CONFIG.Canvas.polygonBackends.move.testCollision"];
}

/**
 * Le canevas de ce client peut-il juger l'abri sur cette scène ? Il faut qu'il soit prêt ET qu'il
 * affiche cette scène : les murs viennent des arêtes du canevas (le polygone `move`), les corps des
 * tokens dessinés. Pendant un changement de niveau, le cœur V14 redessine tout le canevas
 * (`Canvas#draw` → `tearDown`, client/canvas/board.mjs:1122-1151) : `canvas.ready` est faux le temps
 * du redessin — vu le 2026-09-23, une attaque à travers un plancher jugée « sans abri » pendant ce temps.
 */
export function canJudgeCover(scene) {
  return available && !!canvas?.ready && !!scene && (canvas.scene === scene) && !checkCoverApi().length;
}

/** L'espace d'un token en pixels, à sa position validée (ou à `pos`). */
export function rectOf(doc, pos=committedPosition(doc)) {
  const grid = doc.parent.grid;
  return { x: pos.x, y: pos.y, width: Math.max(pos.width ?? 1, 0.5) * grid.sizeX, height: Math.max(pos.height ?? 1, 0.5) * grid.sizeY };
}

/** Hauteur des yeux d'un token à une position : pieds + moitié de sa hauteur (comme `getMovementOrigin` du cœur). */
export function eyeElevation(doc, pos=committedPosition(doc)) {
  return (pos.elevation ?? 0) + ((pos.depth ?? 1) * doc.parent.grid.distance / 2);
}

/**
 * Le prédicat « la ligne de a à b est coupée » entre deux tokens : murs du niveau de `from`, à sa
 * hauteur d'yeux, et surfaces entre les hauteurs d'yeux des deux.
 * @param {TokenDocument} from
 * @param {TokenDocument} to
 * @param {object} [positions]  `posA`, `posB` : positions hypothétiques.
 * @returns {(a: {x: number, y: number}, b: {x: number, y: number}) => boolean}
 */
export function rayBlocker(from, to, { posA, posB }={}) {
  const scene = from.parent;
  const pa = posA ? { ...committedPosition(from), ...posA } : committedPosition(from);
  const pb = posB ? { ...committedPosition(to), ...posB } : committedPosition(to);
  const eyeA = eyeElevation(from, pa);
  const eyeB = eyeElevation(to, pb);
  const level = scene.levels?.get?.(pa.level ?? from._source.level) ?? undefined;
  const backend = CONFIG.Canvas.polygonBackends.move;
  const surfaces = typeof scene.testSurfaceCollision === "function";
  return (a, b) => {
    if ( backend.testCollision({ x: a.x, y: a.y, elevation: eyeA }, { x: b.x, y: b.y, elevation: eyeA }, { type: "move", mode: "any", level }) === true ) return true;
    return surfaces && (scene.testSurfaceCollision({ x: a.x, y: a.y, elevation: eyeA }, { x: b.x, y: b.y, elevation: eyeB }, { type: "move", mode: "any" }) === true);
  };
}

/** Les autres créatures qui peuvent s'interposer. */
function bodiesAround(attacker, target) {
  return attacker.parent.tokens
    .filter(t => (t !== attacker) && (t !== target) && t.actor && !t.hidden && t.object && !isObjectToken(t)
      && bodyGivesCover({ dead: isDeadActor(t.actor), size: t.actor.system?.traits?.size }))
    .map(t => rectOf(t));
}

/**
 * L'abri de la cible contre l'attaquant, ou null s'il n'y a rien à ajouter (pas d'abri, abri déjà
 * posé à la main, calcul impossible).
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {object} [options]
 * @param {object} [options.posA]     Position hypothétique de l'attaquant (au bout d'une approche).
 * @param {boolean} [options.quiet]   Pas de trace en console (calcul au survol).
 * @returns {{degree: string, bonus: number|null, byCreature: boolean}|null}
 */
export function coverFor(attacker, target, { posA, quiet=false }={}) {
  if ( !attacker?.parent || (attacker.parent !== target?.parent) || !canJudgeCover(attacker.parent) ) return null;
  if ( COVER_STATUSES.some(s => target.actor?.statuses.has(s)) ) return null;
  const grid = attacker.parent.grid;
  const cover = coverBetween({
    attacker: rectOf(attacker, posA ? { ...committedPosition(attacker), ...posA } : undefined),
    target: rectOf(target), bodies: bodiesAround(attacker, target),
    blocked: rayBlocker(attacker, target, { posA }), inset: grid.size * INSET_FRACTION
  });
  if ( cover.degree === "none" ) return null;
  if ( !quiet ) console.log(`${MODULE_ID} | abri : ${target.name} contre ${attacker.name} — ${cover.degree}${cover.byCreature ? " (créature interposée)" : ""}`);
  return { degree: cover.degree, bonus: cover.bonus, byCreature: cover.byCreature };
}

/**
 * Ligne d'effet entre deux tokens (P2) : existe tant que l'un n'a pas un abri **total** vis-à-vis de
 * l'autre — murs et surfaces, sans les créatures (elles ne donnent jamais plus qu'un abri partiel).
 * C'est ce qui arrête une émanation (aura), une attaque d'opportunité à travers une trappe.
 * @param {TokenDocument} from
 * @param {TokenDocument} to
 * @param {object} [positions]  `posA`, `posB` : positions hypothétiques.
 * @returns {boolean|null}  null : impossible à dire (canevas absent, scènes différentes).
 */
export function hasLineOfEffect(from, to, positions={}) {
  if ( !canvas?.ready || !from?.parent || (from.parent !== to?.parent) || (canvas.scene !== from.parent) || checkCoverApi().length ) return null;
  const grid = from.parent.grid;
  const posA = positions.posA;
  const posB = positions.posB;
  const cover = coverBetween({
    attacker: rectOf(from, posA ? { ...committedPosition(from), ...posA } : undefined),
    target: rectOf(to, posB ? { ...committedPosition(to), ...posB } : undefined),
    bodies: [], blocked: rayBlocker(from, to, positions), inset: grid.size * INSET_FRACTION
  });
  return cover.degree !== "total";
}

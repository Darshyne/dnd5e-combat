/**
 * M8 (SPEC §18.17) : Avaler / Engloutir vu depuis Foundry. L'item (contenu `swallow`, par identifiant) porte dans le Monster
 * Manual l'effet « avalé » (Aveuglé, Entravé et abri total — ou Agrippé pour le Tertre errant) qu'une de ses activités pose ;
 * une créature est avalée tant qu'elle porte cet effet. Ses activités : les dégâts à chaque tour (`damage`), et la sauvegarde
 * pour ne pas régurgiter (une `save` qui ne pose pas l'effet « avalé »).
 */

import { MODULE_ID } from "../constants.mjs";
import { readSwallow, sizeLimit } from "../core/swallow.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { actorOfEffect } from "./grapple.mjs";
import { dragDestination } from "./movement.mjs";
import { englishDescription } from "./multiattack.mjs";
import { committedPosition } from "./turn.mjs";

/** L'effet « avalé » d'un item : celui qui porte l'abri total, ou l'état Agrippé (Tertre errant). */
const isSwallowedEffectData = e => e.statuses?.has?.("coverTotal") || e.statuses?.has?.("grappled");

/**
 * @returns {{item: Item5e, entry: Activity|null, damage: Activity|null, regurgitate: Activity|null, escape: Activity|null,
 *   effectIds: Set<string>, damageAt: string|null, threshold: number|null, capacity: number|null, grappling: boolean,
 *   forbids: string|null, repeatsSave: boolean, moving: boolean, maxSize: string|null}|null}
 *   `entry` : l'activité qui pose l'effet « avalé » ; `escape` : le test d'évasion (`check`, Cube gélatineux).
 *   §45 : `entryPoses` — faux quand aucune activité du Monster Manual ne pose l'effet (Crapaud géant) : `entry` est alors
 *   l'action de l'item (« Expend Use »), et le moteur pose lui-même l'effet `effectId` sur la créature agrippée
 *   (runtime/swallow.mjs) ; `targetMaxSize` : la taille de ce qui s'avale.
 */
export function swallowOf(item) {
  if ( !item || (contentOf(item).entry?.swallow !== true) ) return null;
  const effectIds = new Set(item.effects.filter(isSwallowedEffectData).map(e => e.id));
  if ( !effectIds.size ) return null;
  const activities = item.system.activities?.contents ?? [];
  const posesSwallow = a => (a.effects ?? []).some(ref => effectIds.has(ref._id ?? ref.effect?.id));
  const poses = activities.find(posesSwallow) ?? null;
  // Crapaud géant (MM 2.x) : ses trois activités sont « Damage: Swallowed », « Escape Corpse » et « Expend Use » — aucune
  // ne relie l'effet « avalé ». L'action sans effet de l'item tient lieu d'entrée.
  const entry = poses ?? activities.find(a => (a.type === "utility") && ["action", "bonus"].includes(a.activation?.type)
    && !(a.effects ?? []).length) ?? null;
  const text = readSwallow(englishDescription(item));
  return {
    item, effectIds, entry, entryPoses: !!poses, effectId: Array.from(effectIds)[0],
    damage: activities.find(a => (a.type === "damage") && !posesSwallow(a)) ?? null,
    regurgitate: activities.find(a => (a.type === "save") && !posesSwallow(a) && a.save?.dc?.value) ?? null,
    escape: activities.find(a => a.type === "check") ?? null,
    ...text,
    // La taille de ce qui s'avale : le texte (Crapaud), sinon la cible de l'activité (« Small or smaller », traduite par Babele).
    targetMaxSize: text.targetMaxSize ?? sizeLimit(entry?.target?.affects?.special),
    // §18.21 : « one Large or smaller creature Grappled by the behir » — la cible de l'activité le dit, pas le texte.
    // Traduit par Babele dans un monde français (« … agrippée par le béhir »).
    grappling: text.grappling || /\bGrappled\b|agripp/i.test(entry?.target?.affects?.special ?? "")
  };
}

/** L'item d'avalement d'un acteur, s'il en a un. */
export function swallowItemOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = swallowOf(item);
    if ( rule ) return rule;
  }
  return null;
}

/** Cet effet rend-il sa créature avalée ? Rend l'item et l'acteur avaleur, ou null. */
export function swallowedBy(effect) {
  if ( !effect?.active ) return null;
  const item = originItemOf(effect);
  const rule = swallowOf(item);
  if ( !rule || !isSwallowedEffectData(effect) ) return null;
  return { rule, swallower: item.actor ?? null };
}


/**
 * Le token avaleur d'un effet « avalé » : celui que nomme l'origine de l'effet (« Scene.<id>.Token.<id>.Actor… » — plusieurs
 * tokens non liés partagent un même acteur de base : trois Zombis dans `dnd-6`), sinon le premier token de l'acteur dans la scène.
 */
export function swallowerTokenFor(effect, by, scene) {
  const origin = String(effect.system?.origin?.activity ?? effect.system?.origin?.item ?? effect.origin ?? "");
  const m = origin.match(/Scene\.([A-Za-z0-9]{16})\.Token\.([A-Za-z0-9]{16})/);
  const named = m ? game.scenes.get(m[1])?.tokens.get(m[2]) : null;
  if ( named ) return named;
  return by?.swallower?.getActiveTokens?.(false, true)?.find(t => t.parent === scene) ?? null;
}

/** Les créatures qu'un token avaleur a dans le ventre : [{ token, effect }]. */
export function swallowedIn(swallowerToken) {
  const out = [];
  for ( const token of swallowerToken?.parent?.tokens ?? [] ) {
    if ( token === swallowerToken ) continue;
    for ( const effect of token.actor?.effects ?? [] ) {
      const by = swallowedBy(effect);
      if ( by && (swallowerTokenFor(effect, by, token.parent) === swallowerToken) ) out.push({ token, effect });
    }
  }
  return out;
}

/** L'avaleur d'un token avalé, dans sa scène : { token, effect, rule } ou null. */
export function swallowerOf(token) {
  for ( const effect of token?.actor?.effects ?? [] ) {
    const by = swallowedBy(effect);
    if ( !by?.swallower ) continue;
    const swallowerToken = swallowerTokenFor(effect, by, token.parent);
    if ( swallowerToken ) return { token: swallowerToken, effect, rule: by.rule };
  }
  return null;
}

/** Le token avalé et son effet, pour un effet qui vient d'être posé. */
export function swallowedTokenOf(effect) {
  const actor = actorOfEffect(effect);
  if ( !actor ) return null;
  return effect.parent?.documentName === "ActorDelta" ? effect.parent.parent : (actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null);
}

/**
 * Pose l'avalé au centre de l'espace de l'avaleur (un pas `displace` : ni attaque d'opportunité). La case est occupée par
 * l'avaleur : dnd5e, en automatisation du déplacement « complète », refuse d'y finir quand ils sont ennemis — `ignoreTokens`,
 * option de contrainte de dnd5e (canvas/token.mjs:92) que le cœur transmet (`constrainOptions`, documents/token.mjs:1723).
 */
export async function placeInside(token, swallowerToken) {
  const grid = token.parent.grid;
  const s = committedPosition(swallowerToken);
  const x = s.x + (((swallowerToken.width - token.width) / 2) * grid.sizeX);
  const y = s.y + (((swallowerToken.height - token.height) / 2) * grid.sizeY);
  await token.move([{ x, y, elevation: s.elevation ?? 0, level: s.level, snapped: false, action: "displace" }],
    { constrainOptions: { ignoreTokens: true }, [MODULE_ID]: { cleared: true, dragged: true } });
}

/** Fait suivre les avalés quand l'avaleur marche (même décalage). */
export async function carrySwallowed(swallowerToken, dx, dy, dz) {
  for ( const { token } of swallowedIn(swallowerToken) ) {
    const p = committedPosition(token);
    await token.move([{ x: p.x + dx, y: p.y + dy, elevation: (p.elevation ?? 0) + dz, level: committedPosition(swallowerToken).level,
      snapped: false, action: "displace" }], { constrainOptions: { ignoreTokens: true }, [MODULE_ID]: { cleared: true, dragged: true } });
  }
}

/** Libère un avalé : l'effet « avalé » retiré, posé sur une case libre au contact de l'avaleur, À terre. */
/** Les effets « avalé » que le moteur retire lui-même (release) : leur suppression ne relance pas la sortie. */
export const releasing = new Set();

/**
 * Libère un avalé : l'effet « avalé » retiré, posé sur une case libre au contact de l'avaleur ; À terre après une
 * régurgitation, une mort ou un recrachement, pas après une évasion (« escapes and enters the nearest unoccupied space »).
 */
export async function release(token, effect, swallowerToken, { prone=true }={}) {
  if ( effect ) releasing.add(effect.uuid);
  try { if ( effect?.parent?.effects?.has?.(effect.id) ) await effect.delete(); }
  finally { if ( effect ) releasing.delete(effect.uuid); }
  await moveOut(token, swallowerToken);
  if ( prone ) await token.actor?.toggleStatusEffect("prone", { active: true });
}

/** Sort un token de l'espace de l'avaleur, sur la case libre au contact la plus proche (s'il y est encore). */
export async function moveOut(token, swallowerToken) {
  if ( !swallowerToken || !overlaps(token, swallowerToken) ) return;
  const spot = swallowerToken ? dragDestination(token, swallowerToken, { x: committedPosition(swallowerToken).x - (token.width * token.parent.grid.sizeX), y: committedPosition(swallowerToken).y }) : null;
  if ( spot ) {
    await token.move([{ x: spot.x, y: spot.y, elevation: committedPosition(swallowerToken).elevation ?? 0, snapped: true, action: "displace" }],
      { [MODULE_ID]: { cleared: true, dragged: true } });
  }
}

/** Rectangle en pixels d'un token à sa position validée. */
export function footprint(token, position=committedPosition(token)) {
  const grid = token.parent.grid;
  return { x: position.x, y: position.y, w: token.width * grid.sizeX, h: token.height * grid.sizeY };
}

function overlaps(a, b) {
  const p = footprint(a), q = footprint(b);
  return (p.x < q.x + q.w - 1e-6) && (q.x < p.x + p.w - 1e-6) && (p.y < q.y + q.h - 1e-6) && (q.y < p.y + p.h - 1e-6);
}

/** Le nom anglais d'un item (Babele garde l'original). */
export const englishNameOf = item => String(item?.flags?.babele?.originalName ?? item?.name ?? "");

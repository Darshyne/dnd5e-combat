/**
 * Fonctions de test (api.mcp) : les aides communes — refus hors MJ, token de la scène affichée, case ou point, position en
 * JSON, fenêtres ouvertes chez le MJ. Extrait de runtime/testing.mjs.
 */

import { cellOf } from "../adapter/movement.mjs";

/** Ces outils agissent en MJ : un client joueur qui les appellerait est refusé. */
export function gmOnly() {
  if ( !game.user.isGM ) throw new Error("GM only");
}

/** Le token désigné, sur la scène affichée par le MJ. */
export function viewedToken({ tokenId }) {
  gmOnly();
  const scene = canvas.scene;
  if ( !scene || !canvas.ready ) throw new Error("no scene displayed");
  const token = scene.tokens.get(tokenId);
  if ( !token ) throw new Error(`token ${tokenId} missing from the viewed scene (${scene.name})`);
  if ( !token.object ) throw new Error(`token ${token.name} not drawn`);
  return token;
}

/** La case visée : `cell` ({ i, j }) ou `point` ({ x, y } en pixels, comme un clic). */
export function cellArg(token, { cell, point }) {
  if ( cell ) return { i: cell.i, j: cell.j };
  if ( point ) return token.parent.grid.getOffset(point);
  throw new Error("cell { i, j } or point { x, y } required");
}

export const finite = n => (Number.isFinite(n) ? n : null);

/** Position validée d'un token : ce que lit le moteur. */
export function positionJson(token) {
  const { x, y, elevation, level } = token._source;
  return { x, y, elevation: elevation ?? 0, level: level ?? null, cell: cellOf(token), movementAction: token.movementAction ?? null };
}

export const waypointOf = ({ x, y, elevation, level, action, climb }) =>
  ({ x, y, elevation: finite(elevation), level: level ?? null, action: action ?? null, climb: finite(climb) });

/** Les fenêtres ouvertes chez le MJ (ApplicationV2) : pour retrouver un dialogue qu'un déplacement bloqué attend. */
export function windows() {
  gmOnly();
  return [...foundry.applications.instances.entries()].map(([id, app]) => ({ id, title: app.title ?? null, className: app.constructor?.name ?? null }));
}

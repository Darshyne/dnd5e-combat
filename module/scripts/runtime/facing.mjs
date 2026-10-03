/**
 * §18.27 : le token se tourne dans le sens de sa marche.
 *  - Pendant l'animation, sur chaque client : l'image (`token.mesh.angle`) suit la direction du dernier bout de chemin
 *    parcouru, lue d'une image à l'autre (`refreshToken`, drapeau `refreshPosition`) — purement visuel, rien n'est écrit.
 *    Le cœur ne remet l'angle qu'à un changement de rotation (placeables/token.mjs:1539, `_refreshRotation`).
 *  - À l'arrivée, le client de celui qui a déplacé le token enregistre la rotation du dernier segment (`moveToken`,
 *    documents/token.mjs:2886), sans animation : tous les clients la gardent, et un cône de vision limité suit.
 * Ni pour une téléportation (`displace`, actions `teleport`), ni pour un token à rotation verrouillée (`lockRotation`).
 * Réglage de monde « Orienter les tokens dans le sens du mouvement ».
 */

import { MODULE_ID } from "../constants.mjs";
import { facingRotation } from "../core/movement.mjs";
import { route } from "./router.mjs";

const SETTING = "faceMovement";
const enabled = () => game.settings.get(MODULE_ID, SETTING) === true;

/** Dernière position affichée de chaque token en mouvement. */
const lastSeen = new WeakMap();

function onRefresh(token, flags) {
  if ( !flags.refreshPosition || !enabled() || token.document.lockRotation ) return;
  if ( !token.animationContexts?.has(token.movementAnimationName) ) { lastSeen.delete(token); return; }
  const here = { x: token.x, y: token.y };   // position VISUELLE, animée : c'est elle qu'on veut ici
  const before = lastSeen.get(token);
  lastSeen.set(token, here);
  if ( !before ) return;
  const dx = here.x - before.x;
  const dy = here.y - before.y;
  if ( Math.hypot(dx, dy) < 1 ) return;
  const rotation = facingRotation(dx, dy);
  if ( rotation !== null ) token.mesh.angle = rotation;
}

const teleports = w => (w.action === "displace") || (CONFIG.Token.movement.actions[w.action]?.teleport === true);

async function onMove(token, movement, operation, user) {
  if ( !user?.isSelf || !enabled() || token.lockRotation ) return;
  const passed = movement.passed?.waypoints ?? [];
  if ( !passed.length || teleports(passed.at(-1)) ) return;
  const points = [movement.origin, ...passed].filter(Boolean);
  // Le dernier segment qui bouge vraiment (un point de passage peut ne changer que l'élévation).
  let rotation = null;
  for ( let n = points.length - 1; (n > 0) && (rotation === null); n-- ) {
    rotation = facingRotation(points[n].x - points[n - 1].x, points[n].y - points[n - 1].y);
  }
  if ( (rotation === null) || (rotation === token.rotation) ) return;
  const animation = token.object?.movementAnimationPromise;
  if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, 10000))]);
  if ( token.lockRotation ) return;
  await token.update({ rotation }, { animate: false, [MODULE_ID]: { facing: true } });
}

export function registerFacing() {
  game.settings.register(MODULE_ID, SETTING, {
    name: `DND5ECOMBAT.Reglage.${SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  route("refreshToken", onRefresh, { label: "orientation : l'image suit la marche" });
  route("moveToken", onMove, { label: "orientation : rotation enregistrée à l'arrivée" });
}

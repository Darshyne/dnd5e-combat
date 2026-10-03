/**
 * Portes (SPEC §18.24) : ouvrir, fermer, et devant une porte verrouillée, la crocheter ou la forcer. Pour l'instant, le
 * crochetage et le forçage ne font que lancer leur test — ni DD, ni porte déverrouillée : le MJ tranche.
 * L'état se lit et s'écrit comme le fait le cœur au clic sur l'icône de porte (canvas/containers/elements/door-control.mjs,
 * `_onMouseDown` / `_onRightDown`) : `wall.document.ds`, mis à jour par le client, droit « WALL_DOORS » requis.
 */

import { loc } from "./shared.mjs";
import { approachDoor } from "./actions.mjs";

const states = () => CONST.WALL_DOOR_STATES;

/** L'état d'une porte : "open", "closed" ou "locked". */
export function doorState(wall) {
  const ds = wall?.document?.ds;
  if ( ds === states().OPEN ) return "open";
  if ( ds === states().LOCKED ) return "locked";
  return "closed";
}

/** Le cœur refuse aux joueurs d'actionner une porte pendant la pause ; on fait de même. */
function mayUse() {
  if ( !game.user.can("WALL_DOORS") ) return false;
  if ( game.paused && !game.user.isGM ) {
    ui.notifications.warn("GAME.PausedWarning", { localize: true });
    return false;
  }
  return true;
}

/**
 * Ouvrir ou fermer, après s'être avancé au contact (`approachDoor`). Une porte verrouillée ne s'ouvre pas : le son de la
 * poignée qui résiste, comme au clic du cœur.
 */
export async function setDoorOpen(token, wall, open) {
  if ( !mayUse() ) return;
  if ( !(await approachDoor(token, wall)) ) return;
  if ( doorState(wall) === "locked" ) {
    wall._playDoorSound?.("test");
    return ui.notifications.info(loc("Porte.Verrouillee"));
  }
  await wall.document.update({ ds: open ? states().OPEN : states().CLOSED });
}

/** MJ : verrouiller une porte fermée, ou la déverrouiller. */
export async function setDoorLocked(wall, locked) {
  if ( !game.user.isGM || (doorState(wall) === "open") ) return;
  await wall.document.update({ ds: locked ? states().LOCKED : states().CLOSED });
}

/**
 * Crocheter : test de Dextérité avec des outils de voleur (Manuel des joueurs 2024 : « Utiliser : crocheter une serrure »).
 * dnd5e ajoute la maîtrise si la créature l'a (actor.mjs, rollToolCheck).
 */
export async function pickLock(token, wall, { event=null }={}) {
  if ( !(await approachDoor(token, wall)) ) return;
  return token?.actor?.rollToolCheck({ tool: "thief", ability: "dex", event }, { configure: false });
}

/** Forcer : test de Force (Athlétisme). */
export async function forceDoor(token, wall, { event=null }={}) {
  if ( !(await approachDoor(token, wall)) ) return;
  return token?.actor?.rollSkill({ skill: "ath", ability: "str", event }, { configure: false });
}

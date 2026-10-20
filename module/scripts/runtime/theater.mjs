/**
 * §220 : le « Théâtre de l'esprit » — un bouton de la barre d'outils du MJ (contrôles des jetons) qui coupe toutes les automatisations
 * du moteur, pour une scène jouée sans plan de combat : plus de déplacement au clic, de menus, de budget de tour, de jets résolus,
 * de réactions, de zones, de vision simulée… dnd5e et le cœur reprennent la main, comme sans le moteur.
 *
 *  - Réglage de monde `theaterOfMind` (partagé : tous les clients suivent), basculé par le bouton du MJ ; chaque client en est averti.
 *  - Le routeur ne passe plus aucun hook (runtime/router.mjs, `paused`), sauf le démarrage (init, setup, ready) et ce bouton ; les
 *    écoutes posées hors du routeur (souris et clavier, modes de détection, tâches périodiques) lisent le même état.
 *  - Les voisins le suivent par le hook `dnd5e-combat.theater` (`active`) et `api.theater.active()`.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { theaterActive, setTheaterState } from "./theater-state.mjs";
import { log, loc } from "./shared.mjs";

export const THEATER_SETTING = "theaterOfMind";
export const THEATER_HOOK = `${MODULE_ID}.theater`;

function applied(on, { announce=true }={}) {
  setTheaterState(on);
  log(`theatre of the mind ${on ? "on: every automation off" : "off: automations back"}`);
  Hooks.callAll(THEATER_HOOK, !!on);
  ui.controls?.render?.({ reset: true });
  if ( announce ) ui.notifications?.info(loc(on ? "Theatre.Actif" : "Theatre.Inactif"));
}

/** Bascule le Théâtre de l'esprit (MJ). */
export async function setTheater(on) {
  if ( !game.user.isGM ) return false;
  await game.settings.set(MODULE_ID, THEATER_SETTING, !!on);
  return true;
}

export const theaterApi = Object.freeze({ active: theaterActive, set: setTheater });

export function registerTheater() {
  game.settings.register(MODULE_ID, THEATER_SETTING, {
    name: `DND5ECOMBAT.Reglage.${THEATER_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${THEATER_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false,
    onChange: value => applied(value)
  });
  // L'état du monde, lu dès que les réglages le sont (avant `ready` : les écoutes de `ready` le liront).
  route("setup", () => setTheaterState(game.settings.get(MODULE_ID, THEATER_SETTING)), { always: true, label: "theatre of the mind: state not read" });
  route("ready", () => { if ( theaterActive() && game.user.isGM ) ui.notifications.info(loc("Theatre.Rappel")); },
    { always: true, label: "theatre of the mind: reminder" });
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-theater"] = {
      name: "das-theater", order: last + 1, icon: "fa-solid fa-masks-theater", title: "DND5ECOMBAT.Theatre.Bouton",
      toggle: true, active: theaterActive(), visible: true,
      onChange: (event, active) => { setTheater(active).catch(err => console.error(`${MODULE_ID} | theatre of the mind`, err)); }
    };
  }, { always: true, label: "theatre of the mind: tool" });
}

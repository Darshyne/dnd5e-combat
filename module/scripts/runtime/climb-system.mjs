/**
 * §224 : l'interrupteur du système d'escalade et de chute — un bouton de la barre d'outils du MJ (contrôles des jetons), sur le modèle
 * du Théâtre de l'esprit (§220), qui coupe ou rallume tout ce que le moteur fait de la hauteur :
 *  - coupé : plus d'alignement du déplacement sur le sol (ni « Trop haut », ni « Dans le vide ! », ni montée refusée au joueur, ni niveau
 *    qui suit l'élévation : runtime/altitude.mjs), l'A* garde l'élévation du token (adapter/path-world.mjs), plus d'escalade (menus,
 *    `api.climb`, jets « maison », chutes du grimpeur : runtime/climb.mjs), plus de chute du moteur (chute automatique, chute avant de
 *    bouger, après un saut, à la fin d'un sort d'élévation : runtime/falls.mjs, `fallLikeDnd5e`) — et l'état « En chute » de dnd5e n'est
 *    plus posé (dnd5e le pose après chaque déplacement d'un token en l'air sans vol : documents/token.mjs:432-444) ;
 *  - au moment de couper, comme de rallumer, aucun token ne bouge : chacun garde son élévation, son mode, ses statuts ; c'est son
 *    prochain déplacement, système rallumé, qui sera aligné (ou tombera).
 *
 *  - Réglage de monde `climbSystem` (activé par défaut), basculé par le bouton ; réglage de monde `climbSystemButton` : le bouton
 *    affiché ou non (le réglage reste dans la fenêtre « DAS · Core »). Chaque client en est averti.
 *  - Les voisins le suivent par le hook `dnd5e-combat.climbSystem` (`enabled`) et `api.climb.enabled()` / `api.climb.setEnabled(on)`.
 *  - Le réglage « Modes de déplacement et élévation » (`altitude`) reste : allumé, l'interrupteur le laisse décider ; coupé, il le domine.
 */

import { MODULE_ID } from "../constants.mjs";
import { climbSystemOn, setClimbSystemState } from "../core/climb-system.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

export const CLIMB_SYSTEM_SETTING = "climbSystem";
export const CLIMB_BUTTON_SETTING = "climbSystemButton";
export const CLIMB_SYSTEM_HOOK = `${MODULE_ID}.climbSystem`;

function applied(on, { announce=true }={}) {
  setClimbSystemState(on);
  log(`climbing and falling ${on ? "on" : "off: free elevation, every token keeps its own"}`);
  Hooks.callAll(CLIMB_SYSTEM_HOOK, !!on);
  ui.controls?.render?.({ reset: true });
  if ( announce ) ui.notifications?.info(loc(on ? "EscaladeSysteme.Actif" : "EscaladeSysteme.Inactif"));
}

/** Allume ou coupe le système d'escalade et de chute (MJ). */
export async function setClimbSystem(on) {
  if ( !game.user.isGM ) return false;
  await game.settings.set(MODULE_ID, CLIMB_SYSTEM_SETTING, !!on);
  return true;
}

const buttonShown = () => {
  try { return game.settings.get(MODULE_ID, CLIMB_BUTTON_SETTING) !== false; } catch { return true; }
};

/** L'effet créé porte-t-il l'état « En chute » de dnd5e ? */
const isFallingEffect = (effect, data) => {
  const statuses = data?.statuses ?? effect?.statuses ?? [];
  return Array.from(statuses).includes("falling");
};

export function registerClimbSystem() {
  game.settings.register(MODULE_ID, CLIMB_SYSTEM_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLIMB_SYSTEM_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLIMB_SYSTEM_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true,
    onChange: value => applied(value)
  });
  game.settings.register(MODULE_ID, CLIMB_BUTTON_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLIMB_BUTTON_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLIMB_BUTTON_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ui.controls?.render?.({ reset: true })
  });
  // L'état du monde, lu dès que les réglages le sont (avant `ready`).
  route("setup", () => setClimbSystemState(game.settings.get(MODULE_ID, CLIMB_SYSTEM_SETTING)), { always: true, label: "climbing switch: state not read" });
  // Système coupé : dnd5e ne pose plus « En chute » (après un déplacement en l'air, ou à la main) — sur le client qui le crée.
  route("preCreateActiveEffect", (effect, data) => {
    if ( climbSystemOn() || !isFallingEffect(effect, data) ) return true;
    log(`${effect.parent?.name ?? "?"}: Falling not applied (climbing and falling off)`);
    return false;
  }, { cancellable: true, label: "climbing switch: Falling status" });
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM || !buttonShown() ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-climb"] = {
      name: "das-climb", order: last + 1, icon: "fa-solid fa-person-falling", title: "DND5ECOMBAT.EscaladeSysteme.Bouton",
      toggle: true, active: climbSystemOn(), visible: true,
      onChange: (event, active) => { setClimbSystem(active).catch(err => console.error(`${MODULE_ID} | climbing switch`, err)); }
    };
  }, { always: true, label: "climbing switch: tool" });
}

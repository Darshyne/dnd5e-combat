/**
 * La vision simulée et l'abri en marche (SPEC §14.1, P1) : les réglages de monde qui les
 * activent, l'auto-contrôle de l'API du cœur à `ready`, et la mise au rebut des sources de vision
 * mémoïsées quand l'environnement change. Les calculs sont dans adapter/vision.mjs (consommé par
 * adapter/conditions.mjs, sur le client de celui qui attaque) et adapter/cover.mjs (consommé par
 * runtime/engine.mjs, sur le MJ actif, au verdict).
 */

import { MODULE_ID } from "../constants.mjs";
import { checkVisionApi, invalidateVision, disposeVision, setVisionAvailable } from "../adapter/vision.mjs";
import { checkCoverApi, setCoverAvailable } from "../adapter/cover.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const VISION_SETTING = "vision";
export const COVER_SETTING = "cover";

function refresh() {
  setVisionAvailable(game.settings.get(MODULE_ID, VISION_SETTING) && !checkVisionApi().length);
  setCoverAvailable(game.settings.get(MODULE_ID, COVER_SETTING) && !checkCoverApi().length);
}

export function registerVision() {
  const world = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`,
    scope: "world", config: true, type: Boolean, default: true, onChange: refresh, ...data
  });
  world(VISION_SETTING);
  world(COVER_SETTING);

  // Murs, lumières, scène (obscurité, niveaux), acteurs (sens, effets) : les sources sont à refaire.
  const stale = { label: "vision : sources à refaire" };
  for ( const hook of ["createWall", "updateWall", "deleteWall", "createAmbientLight", "updateAmbientLight",
    "deleteAmbientLight", "updateScene", "updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, () => invalidateVision(), stale);
  }
  route("canvasTearDown", () => disposeVision(), { label: "vision : sources détruites" });
  route("canvasReady", () => disposeVision(), { label: "vision : sources détruites" });

  route("ready", () => {
    const missing = [...checkVisionApi(), ...checkCoverApi()];
    if ( missing.length ) {
      console.warn(`${MODULE_ID} | vision simulée ou abri hors service : API du cœur absente (${missing.join(", ")})`);
      if ( game.user.isGM ) ui.notifications.warn(game.i18n.format("DND5ECOMBAT.VisionHorsService", { missing: missing.join(", ") }));
    }
    refresh();
    const state = (key, check) => game.settings.get(MODULE_ID, key) ? (check.length ? "hors service" : "en service") : "désactivé (réglage)";
    log(`vision simulée : ${state(VISION_SETTING, checkVisionApi())} ; abri : ${state(COVER_SETTING, checkCoverApi())}`);
  }, { label: "vision : contrôle de l'API" });
}

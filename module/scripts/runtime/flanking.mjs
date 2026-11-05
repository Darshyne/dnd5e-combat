/**
 * §369 (issue GitHub #27) : les réglages de monde de la prise en tenaille (adapter/flanking.mjs), désactivée par défaut. Aucun
 * écouteur : la tenaille se lit à chaque attaque, dans le contexte d'Avantage (adapter/conditions.mjs `attackContext`).
 */
import { MODULE_ID } from "../constants.mjs";
import { FLANKING_SETTING, FLANKING_SIDE_SETTING, FLANKING_CONGA_SETTING } from "../adapter/flanking.mjs";
import { FLANKING_MODES, FLANKING_SIDES } from "../core/flanking.mjs";

const key = (setting, part) => `DND5ECOMBAT.Reglage.${setting}.${part}`;

export function registerFlanking() {
  game.settings.register(MODULE_ID, FLANKING_SETTING, {
    name: key(FLANKING_SETTING, "Nom"), hint: key(FLANKING_SETTING, "Aide"), scope: "world", config: true, type: String,
    choices: Object.fromEntries(FLANKING_MODES.map(m => [m, key(FLANKING_SETTING, m)])), default: "off"
  });
  game.settings.register(MODULE_ID, FLANKING_SIDE_SETTING, {
    name: key(FLANKING_SIDE_SETTING, "Nom"), hint: key(FLANKING_SIDE_SETTING, "Aide"), scope: "world", config: true, type: String,
    choices: Object.fromEntries(FLANKING_SIDES.map(m => [m, key(FLANKING_SIDE_SETTING, m)])), default: "all"
  });
  game.settings.register(MODULE_ID, FLANKING_CONGA_SETTING, {
    name: key(FLANKING_CONGA_SETTING, "Nom"), hint: key(FLANKING_CONGA_SETTING, "Aide"), scope: "world", config: true, type: Boolean, default: false
  });
}

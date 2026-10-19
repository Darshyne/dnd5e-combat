/**
 * §207 : les options de coup critique (adapter/criticals.mjs) — leurs réglages de monde, tous désactivés par défaut, et la requête
 * qui fait tirer une table de critiques du monde par le MJ actif quand c'est un joueur qui a touché.
 */
import { MODULE_ID } from "../constants.mjs";
import { CRIT_MARGIN_SETTING, CRITICAL_MODE_SETTING, CRITICAL_TABLE_SETTING, CRITICAL_NPC_SETTING, CRITICAL_MODES, CRITICAL_TABLE_QUERY, drawHere }
  from "../adapter/criticals.mjs";

import { route } from "./router.mjs";

const key = (setting, part) => `DND5ECOMBAT.Reglage.${setting}.${part}`;

/** Un critique traité autrement (table, voisin) : noté sur la carte de dégâts — il reste un coup critique (jets de mort). */
function onPreRollDamage(config, dialog, message) {
  const kind = config?.[MODULE_ID]?.criticalHit;
  if ( kind ) foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.criticalHit`, kind);
  return true;
}

export function registerCriticals() {
  game.settings.register(MODULE_ID, CRIT_MARGIN_SETTING, {
    name: key(CRIT_MARGIN_SETTING, "Nom"), hint: key(CRIT_MARGIN_SETTING, "Aide"), scope: "world", config: true,
    type: Number, range: { min: 0, max: 20, step: 1 }, default: 0
  });
  game.settings.register(MODULE_ID, CRITICAL_MODE_SETTING, {
    name: key(CRITICAL_MODE_SETTING, "Nom"), hint: key(CRITICAL_MODE_SETTING, "Aide"), scope: "world", config: true, type: String,
    choices: Object.fromEntries(CRITICAL_MODES.map(m => [m, key(CRITICAL_MODE_SETTING, m)])), default: "standard"
  });
  game.settings.register(MODULE_ID, CRITICAL_TABLE_SETTING, {
    name: key(CRITICAL_TABLE_SETTING, "Nom"), hint: key(CRITICAL_TABLE_SETTING, "Aide"), scope: "world", config: true, type: String, default: ""
  });
  game.settings.register(MODULE_ID, CRITICAL_NPC_SETTING, {
    name: key(CRITICAL_NPC_SETTING, "Nom"), hint: key(CRITICAL_NPC_SETTING, "Aide"), scope: "world", config: true, type: Boolean, default: false
  });
  // Un joueur ne peut pas marquer tiré le résultat d'une table du monde : le MJ actif tire à sa place, au nom de l'attaquant.
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "critical hit: noted on the damage card" });
  CONFIG.queries[CRITICAL_TABLE_QUERY] = async ({ speaker=null }={}) => (game.user.isGM ? drawHere(null, speaker) : null);
}

/**
 * Le niveau d'automatisation du monde (SPEC §117, core/levels.mjs) : Essentiel, Assisté, Intégral.
 *
 * Un réglage de monde, enregistré le PREMIER — la fenêtre des réglages du cœur liste ceux d'un module dans leur ordre
 * d'inscription (client/applications/settings/config.mjs:71), il s'y lit donc en tête. Il est lu une fois, au chargement : en
 * changer recharge le monde (`requiresReload`), car il décide de ce qui s'inscrit sur les hooks.
 */
import { MODULE_ID } from "../constants.mjs";
import { LEVELS, DEFAULT_LEVEL, atLeast, featureLevel } from "../core/levels.mjs";
import { setContentEnabled } from "../adapter/content.mjs";
import { withoutRoutes } from "./router.mjs";
import { log } from "./shared.mjs";

export const LEVEL_SETTING = "automationLevel";

let current = DEFAULT_LEVEL;

/** Le niveau en vigueur sur ce client. */
export function automationLevel() {
  return current;
}

/** Le niveau en vigueur comprend-il ce qui demande `min` ? */
export function levelAtLeast(min) {
  return atLeast(current, min);
}

/** À appeler en tout premier, pendant `init` : déclare le réglage, lit le niveau, ouvre ou ferme le contenu. */
export function registerLevel() {
  game.settings.register(MODULE_ID, LEVEL_SETTING, {
    name: "DND5ECOMBAT.Niveau.Nom", hint: "DND5ECOMBAT.Niveau.Aide",
    scope: "world", config: true, type: String, default: DEFAULT_LEVEL, requiresReload: true,
    choices: Object.fromEntries(LEVELS.map(l => [l, `DND5ECOMBAT.Niveau.${l}`]))
  });
  const stored = game.settings.get(MODULE_ID, LEVEL_SETTING);
  current = LEVELS.includes(stored) ? stored : DEFAULT_LEVEL;
  setContentEnabled(atLeast(current, "full"));
  log(`automation level: ${current}`);
}

/**
 * Inscrit une fonction du point d'entrée selon le niveau : à son niveau ou au-dessus, normalement ; au-dessous, sans ses
 * écoutes (ses réglages et ses requêtes restent déclarés, pour qui les lit).
 */
export function gated(register) {
  return levelAtLeast(featureLevel(register.name)) ? register() : withoutRoutes(register.name, register);
}

import { MODULE_ID } from "../constants.mjs";

/**
 * Un réglage du moteur, ou `fallback` s'il n'est pas (encore) enregistré : une règle lue avant `init`, ou dans un test hors de
 * Foundry, ne casse pas.
 */
export function settingOr(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); }
  catch { return fallback; }
}

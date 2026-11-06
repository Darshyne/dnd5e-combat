/**
 * §381 (issue #35) : qui la table attend — les réglages, la requête qui porte les attentes d'un client à l'autre, et ce qui les fait
 * tomber sans réponse : la déconnexion de celui qui répond (hook du cœur `userConnected`, client/documents/collections/users.mjs:137) et
 * l'oubli d'une attente sans nouvelles. Un client qui arrive demande les attentes en cours (`ready`).
 */

import { MODULE_ID } from "../constants.mjs";
import { AWAITING_GM_MODES, AWAITING_REFRESH_MS } from "../core/awaiting.mjs";
import { AWAITING_QUERY, changeAwaiting, pruneKnown, receiveAwaiting, refreshAwaiting, syncAwaiting } from "../adapter/awaiting.mjs";
import { route } from "./router.mjs";

export const AWAITING_SETTINGS = Object.freeze({ show: "awaitingShow", gm: "awaitingGm", names: "awaitingNames", hide: "awaitingHide" });
/** Un réglage d'affichage a changé, sur ce client (le dessin se refait). */
export const AWAITING_SETTINGS_HOOK = `${MODULE_ID}.awaitingSettings`;

let heartbeat = null;

export function registerAwaiting() {
  const S = AWAITING_SETTINGS;
  const key = k => `DND5ECOMBAT.Reglage.${k}`;
  const onChange = () => Hooks.callAll(AWAITING_SETTINGS_HOOK);
  game.settings.register(MODULE_ID, S.show, { scope: "world", config: true, type: Boolean, default: true,
    name: `${key(S.show)}.Nom`, hint: `${key(S.show)}.Aide`, onChange });
  game.settings.register(MODULE_ID, S.gm, { scope: "world", config: true, type: String, default: "discreet",
    choices: Object.fromEntries(AWAITING_GM_MODES.map(m => [m, `${key(S.gm)}.Choix.${m}`])),
    name: `${key(S.gm)}.Nom`, hint: `${key(S.gm)}.Aide`, onChange });
  game.settings.register(MODULE_ID, S.names, { scope: "world", config: true, type: Boolean, default: true,
    name: `${key(S.names)}.Nom`, hint: `${key(S.names)}.Aide`, onChange });
  game.settings.register(MODULE_ID, S.hide, { scope: "client", config: true, type: Boolean, default: false,
    name: `${key(S.hide)}.Nom`, hint: `${key(S.hide)}.Aide`, onChange });
  CONFIG.queries[AWAITING_QUERY] = receiveAwaiting;

  route("ready", () => {
    syncAwaiting();
    clearInterval(heartbeat);
    // Rafraîchir ses attentes (les autres ne les oublient pas) et oublier celles des autres restées sans nouvelles.
    heartbeat = setInterval(() => {
      refreshAwaiting();
      pruneKnown();
    }, AWAITING_REFRESH_MS);
  }, { label: "awaiting: not synchronised", always: true });
  route("userConnected", (user, connected) => {
    if ( !connected ) changeAwaiting({ type: "drop", userId: user.id });
  }, { label: "awaiting: a disconnected user's prompts not cleared", always: true });
}

/** Les réglages qui décident de ce que ce client montre (lus par ui/awaiting.mjs et `api.ui.awaiting`). */
export function awaitingViewer() {
  const get = (k, fallback) => { try { return game.settings.get(MODULE_ID, k); } catch { return fallback; } };
  return {
    userId: game.user?.id ?? null, isGM: game.user?.isGM === true,
    enabled: get(AWAITING_SETTINGS.show, true) !== false,
    hidden: get(AWAITING_SETTINGS.hide, false) === true,
    gmMode: get(AWAITING_SETTINGS.gm, "discreet"),
    names: get(AWAITING_SETTINGS.names, true) !== false
  };
}

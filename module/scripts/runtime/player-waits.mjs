/**
 * §290 : les fenêtres du combat sans délai (demande de l'utilisateur, 2026-10-30). Réglage de monde `combatWindowUnlimited` : une
 * question posée à un joueur (réaction, choix, sauvegarde…) attend sa réponse sans compte à rebours ; le MJ voit qui il attend
 * (ui/player-waits.mjs, ouverte d'elle-même au bout du délai des fenêtres) et peut **forcer** : la fenêtre se ferme chez le joueur avec la
 * réponse que le délai aurait donnée. Un joueur qui se déconnecte compte comme une absence de réponse (adapter/player-wait.mjs).
 *
 * Retour à la table quand le MJ force : texte au-dessus du token du personnage et son, chez chaque client.
 */

import { MODULE_ID } from "../constants.mjs";
import { FORCE_WINDOWS_QUERY, forcePlayerWait, handleForceWindows, playerWaits } from "../adapter/player-wait.mjs";
import { log, notice, tokenOfActor } from "./shared.mjs";

/**
 * Le MJ force l'attente `id` (fenêtre de suivi, menu du token, `api.waits.force`).
 * @param {string} id
 */
export async function forceWait(id) {
  if ( !game.user.isGM ) return false;
  const wait = playerWaits().find(w => w.id === id);
  if ( !wait ) return false;
  const actor = wait.actor ? await fromUuid(wait.actor) : null;
  const token = tokenOfActor(actor);
  if ( token ) notice(token, { key: "Attente.Avis", data: { name: wait.userName } }, "refused", { all: true, action: "forced", outcome: "success" });
  log(`${wait.userName}'s answer forced by the GM (${wait.label || wait.actorName})`);
  return forcePlayerWait(id);
}

/** Les attentes d'un personnage (menu de son token). */
export const waitsOf = actor => (actor ? playerWaits().filter(w => w.actor === actor.uuid) : []);

export function registerPlayerWaits() {
  game.settings.register(MODULE_ID, "combatWindowUnlimited", {
    name: "DND5ECOMBAT.Reglage.combatWindowUnlimited.Nom", hint: "DND5ECOMBAT.Reglage.combatWindowUnlimited.Aide",
    scope: "world", config: true, type: Boolean, default: false
  });
  CONFIG.queries[FORCE_WINDOWS_QUERY] = handleForceWindows;   // sur tous les clients : c'est celui du joueur qui ferme ses fenêtres
}

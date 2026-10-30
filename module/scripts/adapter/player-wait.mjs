/**
 * §290 : les questions posées à un joueur quand les fenêtres du combat sont sans délai (réglage de monde `combatWindowUnlimited`).
 * Le client qui pose la question (en général le MJ actif) attend aussi longtemps qu'il le faut ; chez un MJ, chaque attente est notée ici
 * — qui, pour quel personnage, quoi, depuis quand — pour sa fenêtre de suivi (ui/player-waits.mjs). « Forcer » demande au client du
 * joueur de résoudre ses fenêtres comme au bout du délai (`forceOpenWindows`, adapter/dialogs.mjs) : la question revient avec la
 * réponse par défaut. Un joueur qui se déconnecte : la question échoue aussitôt, comme une absence de réponse.
 *
 * Fenêtres avec délai (réglage par défaut) : la requête du cœur, telle quelle (`user.query`, client/documents/user.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { forceOpenWindows, windowsUnlimited } from "./dialogs.mjs";

export const FORCE_WINDOWS_QUERY = `${MODULE_ID}.forceWindows`;
export const PLAYER_WAITS_HOOK = `${MODULE_ID}.playerWaits`;

/** Sans délai, une question attend au plus ça (la partie a été quittée entre-temps, pas un joueur qui réfléchit). */
const UNLIMITED_TIMEOUT = 3 * 60 * 60 * 1000;
/** Après « Forcer », la question est lâchée si elle n'est pas revenue (fenêtre déjà fermée, client figé). */
const FORCE_GRACE_MS = 4000;

/** Les attentes en cours sur ce client : id → `{ id, userId, actor, label, since, abandon }`. */
const waits = new Map();

const changed = () => Hooks.callAll(PLAYER_WAITS_HOOK, playerWaits());

/** Les attentes en cours, la plus ancienne d'abord. */
export function playerWaits() {
  return [...waits.values()].map(({ abandon, ...w }) => w).sort((a, b) => a.since - b.since);
}

/**
 * Pose la question `name` au joueur `user`. Avec délai : la requête du cœur. Sans délai : attend sans limite, notée pour le suivi du MJ.
 * Lève comme `user.query` quand il n'y a pas de réponse (joueur parti, question lâchée).
 * @param {User} user
 * @param {string} name     La requête (`CONFIG.queries`).
 * @param {object} payload
 * @param {object} options
 * @param {number} options.timeout       Le délai de la requête quand les fenêtres en ont un.
 * @param {Actor|null} [options.actor]   Le personnage concerné.
 * @param {string} [options.label]       Ce que le joueur a sous les yeux (« Réaction », « Bouclier »…), déjà traduit.
 */
export async function queryPlayer(user, name, payload, { timeout, actor=null, label="" }={}) {
  if ( !windowsUnlimited() ) return user.query(name, payload, { timeout });
  const id = foundry.utils.randomID();
  const { promise: abandoned, reject: abandon } = Promise.withResolvers();
  waits.set(id, { id, userId: user.id, userName: user.name, actor: actor?.uuid ?? null, actorName: actor?.name ?? "",
    img: actor?.img ?? null, label: String(label ?? ""), since: Date.now(), abandon });
  changed();
  // Un joueur qui part ne répondra plus : comme une absence de réponse.
  const watch = setInterval(() => { if ( !user.active ) abandon(new Error(`${user.name} disconnected`)); }, 1000);
  try { return await Promise.race([user.query(name, payload, { timeout: UNLIMITED_TIMEOUT }), abandoned]); }
  finally {
    clearInterval(watch);
    waits.delete(id);
    changed();
  }
}

/**
 * Le MJ force l'attente `id` : le client du joueur résout ses fenêtres du combat comme au bout du délai. Rend false si elle n'existe plus.
 * @param {string} id
 */
export async function forcePlayerWait(id) {
  const wait = waits.get(id);
  if ( !wait ) return false;
  const user = game.users.get(wait.userId);
  try { if ( user?.active ) await user.query(FORCE_WINDOWS_QUERY, {}, { timeout: FORCE_GRACE_MS }); }
  catch(err) { console.warn(`${MODULE_ID} | forcing ${wait.userName}'s windows`, err); }
  // La réponse par défaut revient d'elle-même ; sinon (aucune fenêtre ouverte chez lui), la question est lâchée.
  setTimeout(() => waits.get(id)?.abandon(new Error(`forced by the GM`)), FORCE_GRACE_MS);
  return true;
}

/** Chez le joueur : le MJ force (requête `FORCE_WINDOWS_QUERY`). Rend le nombre de fenêtres résolues. */
export function handleForceWindows() {
  return forceOpenWindows();
}

/** Ce que le joueur a sous les yeux, pour la fenêtre de suivi (`DND5ECOMBAT.Attente.Quoi.<key>`). */
export function waitLabel(key, data={}) {
  return game.i18n.format(`DND5ECOMBAT.Attente.Quoi.${key}`, data);
}

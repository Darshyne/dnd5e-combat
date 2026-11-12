/**
 * §421 : la « File du MJ » (core/gm-queue.mjs) côté Foundry — ce que le MJ doit décider, les joueurs qu'il attend, les actions bloquées
 * par un auteur parti ; et ses deux gestes : forcer la fenêtre d'un joueur, lancer à la place d'un absent.
 *
 * Complément du retour à la table, pas son remplaçant : le sablier au-dessus des tokens et le bandeau « Le MJ décide… »
 * (ui/awaiting.mjs) disent aux joueurs qu'on attend quelqu'un ; la file dit au MJ qui, pour quoi, et lui donne la main.
 *
 * Forcer : toute fenêtre du combat ouverte sur un client s'y inscrit (`expireLater`, adapter/dialogs.mjs), qu'elle vienne d'une question
 * du MJ ou qu'elle se soit ouverte d'elle-même chez l'auteur (dégâts au clic, châtiment, Attaque sournoise, coup critique) : le MJ
 * demande au client du joueur de les résoudre comme au bout du délai. Avant ce §, seules les questions posées par le MJ avaient une
 * ligne à forcer ; une fenêtre ouverte chez l'auteur, sans délai, n'avait pas d'issue.
 */
import { MODULE_ID } from "../constants.mjs";
import { gmQueue, queueSignature } from "../core/gm-queue.mjs";
import { AWAITING_HOOK, awaitingList } from "../adapter/awaiting.mjs";
import { FORCE_WINDOWS_QUERY, PLAYER_WAITS_HOOK, forcePlayerWait, playerWaits } from "../adapter/player-wait.mjs";
import { combatWindowSeconds, windowsUnlimited } from "../adapter/dialogs.mjs";
import { blockedRolls, rollForAbsent } from "./engine.mjs";
import { route } from "./router.mjs";
import { log, notice, tokenOfActor, isExecutor } from "./shared.mjs";

/**
 * §421 : chez un MJ, quand une ligne de sa file arrive, part ou reçoit son libellé : `(queue)`, `{ mine, players, blocked, count }` —
 * ce que le moteur lui demande, les joueurs attendus, les actions dont l'auteur est parti. Une ligne :
 * `{ id, userId, userName, actor, kind, label, since, seconds, waitIds }`. Lecture seule ; la même file : `api.queue.list()`.
 */
export const GM_QUEUE_HOOK = `${MODULE_ID}.gmQueue`;

/** Le délai laissé au client d'un joueur pour résoudre ses fenêtres quand le MJ force. */
const FORCE_GRACE_MS = 4000;

/**
 * MJ : la file — `{ mine, players, blocked, count }` (ce que le moteur lui demande, les joueurs attendus, les actions dont l'auteur est
 * parti) ; vide chez un joueur. Une ligne : `{ id, userId, userName, actor, kind, label, since, seconds, waitIds }`.
 */
export function queue() {
  if ( !game.user?.isGM ) return gmQueue();
  return gmQueue({ awaiting: awaitingList(), waits: playerWaits(), blocked: blockedRolls() });
}

let last = "";
function changed() {
  if ( !game.user?.isGM ) return;
  const now = queue();
  const signature = queueSignature(now);
  if ( signature === last ) return;
  last = signature;
  Hooks.callAll(GM_QUEUE_HOOK, now);
}

/**
 * Le MJ force la ligne `id` de « J'attends un joueur » : sa fenêtre se ferme chez lui avec la réponse que le délai aurait donnée. La table
 * le voit (texte au-dessus du token). Rend false si la ligne n'existe plus, ou chez un joueur.
 * @param {string} id
 */
export async function forceLine(id) {
  if ( !game.user.isGM ) return false;
  const line = queue().players.find(l => l.id === id);
  if ( !line ) return false;
  const actor = line.actor ? await fromUuid(line.actor) : null;
  const token = tokenOfActor(actor);
  if ( token ) notice(token, { key: "Attente.Avis", data: { name: line.userName } }, "refused", { all: true, action: "forced", outcome: "success" });
  log(`${line.userName}'s window forced by the GM (${line.label || line.kind})`);
  // Une question posée par ce client : elle sait se lâcher si la réponse ne revient pas (adapter/player-wait.mjs).
  if ( line.waitIds.length ) {
    for ( const waitId of line.waitIds ) await forcePlayerWait(waitId);
    return true;
  }
  const user = game.users.get(line.userId);
  try { if ( user?.active ) await user.query(FORCE_WINDOWS_QUERY, {}, { timeout: FORCE_GRACE_MS }); }
  catch(err) { console.warn(`${MODULE_ID} | forcing ${line.userName}'s windows`, err); }
  return true;
}

/**
 * Le MJ lance à la place d'un auteur parti le jet que doit la ligne `id` de « Bloqué » (ou l'identifiant de son message). MJ actif.
 * @param {string} id
 */
export async function rollBlocked(id) {
  const done = await rollForAbsent(String(id ?? "").replace(/^blocked:/, ""));
  changed();
  return done;
}

export function registerGmQueue() {
  const always = { always: true };
  route(AWAITING_HOOK, changed, { ...always, label: "GM queue: not refreshed (awaiting)" });
  route(PLAYER_WAITS_HOOK, changed, { ...always, label: "GM queue: not refreshed (waits)" });
  // Une résolution qui avance peut lever un blocage (le jet est arrivé).
  route("updateChatMessage", (message, changes) => { if ( changes.flags?.[MODULE_ID]?.resolution ) changed(); },
    { ...always, label: "GM queue: not refreshed (resolution)" });
  route("userConnected", (user, connected) => {
    changed();
    if ( connected || !isExecutor() ) return;
    // « Les fenêtres du combat ne retiennent pas la partie » : avec un délai, le jet qu'un joueur parti devait est lancé pour lui au bout
    // de ce délai. Sans délai, c'est le MJ qui décide, depuis sa file (« Bloqué »).
    if ( windowsUnlimited() ) return;
    setTimeout(async () => {
      if ( game.users.get(user.id)?.active ) return;   // revenu entre-temps : c'est à lui
      for ( const stuck of blockedRolls().filter(b => b.userId === user.id) ) {
        log(`${user.name} left with a roll due (${stuck.item}): rolled for them`);
        await rollForAbsent(stuck.messageId);
      }
      changed();
    }, combatWindowSeconds() * 1000);
  }, { ...always, label: "GM queue: a roll due by a player who left" });
}

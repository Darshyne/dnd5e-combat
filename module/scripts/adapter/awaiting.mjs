/**
 * §381 (issue #35) : qui la table attend. Le client sur lequel une fenêtre de réaction, de choix ou de jet est ouverte le dit à tous les
 * autres ; chacun garde le tableau des attentes connues et le publie (hook `dnd5e-combat.awaiting`, `api.ui.awaiting()`). Le moteur ne
 * nomme aucun voisin : le sablier au-dessus du token (ui/awaiting.mjs), les portraits d'une interface voisine, lisent ce tableau.
 *
 * Diffusion par les requêtes du cœur (`user.query`, client/documents/user.mjs), comme les minuteries du §272 : pas de socket de module,
 * rien n'est écrit dans un document. Ce qui part ne dit jamais ce que la fenêtre demande (core/awaiting.mjs, `awaitingEntry`).
 *
 * Fin d'une attente : `release()` (réponse, délai, annulation, réponse forcée — appelé dans un `finally`) ; la déconnexion de celui qui
 * répond (hook du cœur `userConnected`, runtime/awaiting.mjs) ; à défaut, l'oubli d'une attente qui n'a plus de nouvelles (core).
 */

import { MODULE_ID } from "../constants.mjs";
import { applyAwaiting, awaitingEntry, pruneAwaiting } from "../core/awaiting.mjs";

export const AWAITING_QUERY = `${MODULE_ID}.awaiting`;
/**
 * §381 : sur chaque client, à chaque changement du tableau des attentes qu'il connaît (une fenêtre de réaction, de choix ou de jet
 * ouverte ou fermée quelque part, une attente oubliée) : `(entries)`, les attentes en cours, les plus anciennes d'abord —
 * `{ id, userId, userName, token, actor, kind, gm, player, since, seconds, refreshed }`, jamais ce que la fenêtre demande. Lecture seule ;
 * le même tableau : `api.ui.awaiting()`.
 */
export const AWAITING_HOOK = `${MODULE_ID}.awaiting`;

/** Les attentes ouvertes sur CE client (celles qu'il diffuse) : id → entrée. */
const mine = new Map();
/** Toutes les attentes connues de ce client, la sienne comprise. */
let known = [];

const publish = () => Hooks.callAll(AWAITING_HOOK, awaitingList());

/** Les attentes en cours connues de ce client, les plus anciennes d'abord (forme publique, sans ce que la fenêtre demande). */
export function awaitingList() {
  known = pruneAwaiting(known, Date.now());
  return known.map(e => ({ ...e }));
}

/** Oublier les attentes expirées ; publier s'il en est tombé. */
export function pruneKnown() {
  const before = known.length;
  known = pruneAwaiting(known, Date.now());
  if ( known.length !== before ) publish();
}

/** Changer le tableau de ce client et le publier. */
export function changeAwaiting(change) {
  known = applyAwaiting(known, change);
  publish();
}

/** Les attentes ouvertes sur ce client (pour les rafraîchir, ou répondre à un client qui arrive). */
export const ownAwaiting = () => [...mine.values()];

function send(payload) {
  for ( const user of game.users ) {
    if ( !user.active || user.isSelf ) continue;
    user.query(AWAITING_QUERY, payload, { timeout: 5000 }).catch(() => {});
  }
}

/** Diffuse à nouveau toutes les attentes de ce client (rafraîchissement : elles ne sont pas oubliées). */
export function refreshAwaiting() {
  if ( !mine.size ) return;
  const now = Date.now();
  for ( const entry of mine.values() ) entry.refreshed = now;
  changeAwaiting({ type: "replace", userId: game.user.id, list: ownAwaiting() });
  send({ type: "replace", userId: game.user.id, list: ownAwaiting() });
}

/** Le token d'un acteur sur la scène affichée (un token non lié est le sien). */
function tokenOf(actor, token) {
  // `getActiveTokens(false, true)` rend des TokenDocument ; un Token du canevas porte le sien en `document`.
  const found = token ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  return (found?.document ?? found)?.uuid ?? null;
}

/**
 * Une fenêtre qui fait attendre la table vient de s'ouvrir sur ce client. Rend `release()`, à appeler à sa fermeture quelle qu'en soit la
 * raison (sans effet la seconde fois).
 * @param {Actor|null} actor   La créature concernée (celle qui réagit, choisit ou lance les dés).
 * @param {"reaction"|"choice"|"roll"} kind
 * @param {{seconds?: number|null, token?: TokenDocument|Token|null}} [options]  `seconds` : le délai de la fenêtre, s'il y en a un.
 * @returns {() => void}
 */
export function markAwaiting(actor, kind, { seconds=null, token=null }={}) {
  if ( !game?.user ) return () => {};
  const now = Date.now();
  const entry = awaitingEntry({
    id: foundry.utils.randomID(), userId: game.user.id, userName: game.user.name,
    token: tokenOf(actor, token), actor: actor?.uuid ?? null, kind,
    gm: game.user.isGM === true, player: actor?.hasPlayerOwner === true,
    since: now, seconds, refreshed: now
  });
  if ( !entry ) return () => {};
  mine.set(entry.id, entry);
  changeAwaiting({ type: "add", entry });
  send({ type: "add", entry });
  let released = false;
  const release = () => {
    if ( released ) return;
    released = true;
    mine.delete(entry.id);
    changeAwaiting({ type: "remove", id: entry.id });
    send({ type: "remove", id: entry.id });
  };
  release.id = entry.id;   // §422 : pour relier la fenêtre ouverte à sa ligne de la File du MJ
  return release;
}

/**
 * `fn()` pendant qu'une attente est affichée ; elle tombe quand `fn` se termine, réussite ou erreur.
 * @template T
 * @param {Actor|null} actor
 * @param {"reaction"|"choice"|"roll"} kind
 * @param {() => Promise<T>|T} fn
 * @param {{seconds?: number|null, token?: object}} [options]
 * @returns {Promise<T>}
 */
export async function whileAwaiting(actor, kind, fn, options={}) {
  const release = markAwaiting(actor, kind, options);
  try { return await fn(); }
  finally { release(); }
}

/**
 * Chez chaque client : une attente d'un autre arrive, part, ou un client donne toutes les siennes. `sync` : un client qui arrive demande
 * les attentes ouvertes ici (rendues telles quelles).
 */
export function receiveAwaiting(payload={}, { user }={}) {
  if ( payload.type === "sync" ) return ownAwaiting();
  // Un client ne parle que de ses propres attentes.
  const from = user?.id ?? null;
  if ( payload.type === "add" ) {
    if ( from && (payload.entry?.userId !== from) ) return false;
    changeAwaiting({ type: "add", entry: payload.entry });
  }
  else if ( payload.type === "remove" ) {
    const entry = known.find(e => e.id === payload.id);
    if ( entry && from && (entry.userId !== from) ) return false;
    changeAwaiting({ type: "remove", id: payload.id });
  }
  else if ( payload.type === "replace" ) {
    if ( from && (payload.userId !== from) ) return false;
    changeAwaiting({ type: "replace", userId: payload.userId, list: payload.list });
  }
  return true;
}

/** Un client qui arrive : demande aux autres clients connectés leurs attentes ouvertes. */
export async function syncAwaiting() {
  await Promise.all([...game.users].filter(u => u.active && !u.isSelf).map(async user => {
    const list = await user.query(AWAITING_QUERY, { type: "sync" }, { timeout: 5000 }).catch(() => null);
    if ( Array.isArray(list) ) changeAwaiting({ type: "replace", userId: user.id, list });
  }));
}

/** Pour les tests du moteur (`api.mcp`) : les attentes de ce client, et les marqueurs posés à la main. */
export const testing = { mine: ownAwaiting };

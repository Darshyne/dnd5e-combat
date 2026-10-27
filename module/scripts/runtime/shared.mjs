/** Ce que tout le runtime partage (SPEC §13, S1) : une seule définition de chaque chose. */

import { MODULE_ID } from "../constants.mjs";
import { actionSound, noticeText } from "../core/action-feedback.mjs";

export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

export const NOTICE_HOOK = `${MODULE_ID}.notice`;
export const FEEDBACK_HOOK = `${MODULE_ID}.feedback`;
/** §252 : la requête qui fait dessiner un avis chez un autre client (ui/feedback.mjs l'enregistre). */
export const NOTICE_QUERY = `${MODULE_ID}.notice`;

/**
 * Un avis du moteur au-dessus d'un token (refus, invite : « Déjà visé », « Trop loin »), sur ce client : publié pour
 * l'interface (ui/feedback.mjs), qui l'écrit en texte défilant. Le runtime ne connaît pas l'interface.
 *
 * §252 (règles DAS du 2026-10-27) : `all: true` en fait le retour d'une **action** pour toute la table — le texte est dessiné chez
 * chaque client connecté (requête `NOTICE_QUERY`) et un son est diffusé à tous. `text` peut alors être `{ key, data }` (clé sans le
 * préfixe `DND5ECOMBAT.`), traduit chez chacun. Le son : `sound` s'il est donné (null : aucun), sinon celui de `action` / `outcome`
 * (core/action-feedback.mjs). Avant de le jouer, le hook public `dnd5e-combat.feedback` `({ token, action, outcome, kind, text, sound })`
 * est appelé sur ce client seulement (`Hooks.call`) : un module voisin qui joue lui-même son animation et son son rend `false`, et le
 * moteur se tait. Les refus et les invites restent locaux (`all` faux).
 */
export function notice(token, text, kind="refused", { all=false, action=null, outcome=null, sound=undefined }={}) {
  const uuid = token?.uuid ?? token?.document?.uuid ?? token ?? null;
  if ( !uuid ) return;
  Hooks.callAll(NOTICE_HOOK, { token: uuid, text: noticeText(text, loc), kind });
  if ( !all ) return;
  for ( const user of game.users ) {
    if ( !user.active || user.isSelf ) continue;
    user.query(NOTICE_QUERY, { token: uuid, text, kind }, { timeout: 5000 }).catch(() => {});
  }
  const src = (sound === undefined) ? actionSound(action, outcome) : sound;
  const allowed = Hooks.call(FEEDBACK_HOOK, { token: uuid, action, outcome, kind, text: noticeText(text, loc), sound: src });
  if ( (allowed !== false) && src ) foundry.audio.AudioHelper.play({ src, volume: 0.8, loop: false }, true)?.catch?.(() => {});
}

/** §252 : chez un autre client, l'avis qu'une action de la table lui fait voir (requête `NOTICE_QUERY`). */
export function receiveNotice({ token, text, kind }={}) {
  if ( token ) Hooks.callAll(NOTICE_HOOK, { token, text: noticeText(text, loc), kind });
  return true;
}

/** Un texte échappé pour du HTML (noms d'acteurs, d'objets…). */
export const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Une traduction dont les textes insérés (noms d'acteurs, d'objets…) sont échappés : pour une carte de chat. */
export const locEsc = (key, data={}) =>
  loc(key, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (typeof v === "string") ? esc(v) : v])));

/**
 * Une carte de chat du moteur : une ligne par paragraphe (`lines`, du HTML déjà sûr — `locEsc` pour y mettre des noms), dite par
 * `speaker` (`{ actor }` ou `{ token }` pour `getSpeaker`, ou `{ alias }`), avec ses `flags` du moteur et, s'il le faut, en aparté
 * (`whisper` : ids d'utilisateurs).
 */
export function say(speaker, lines, flags=null, { whisper=null }={}) {
  const data = {
    speaker: ("alias" in speaker) ? speaker : ChatMessage.implementation.getSpeaker(speaker),
    content: [lines].flat().map(line => `<p>${line}</p>`).join("")
  };
  if ( flags ) data.flags = { [MODULE_ID]: flags };
  if ( whisper ) data.whisper = whisper;
  return ChatMessage.implementation.create(data);
}

/** Attendre `ms` millisecondes. */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const loc = (key, data) => data ? game.i18n.format(`DND5ECOMBAT.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.${key}`);

/** SPEC §5.3 : le MJ actif est l'unique exécutant du moteur. */
export function isExecutor() {
  return game.users.activeGM?.isSelf === true;
}

/**
 * Faire `handler(payload)` chez le MJ actif : ici si l'on est lui, sinon par la requête `query` (`CONFIG.queries`). Sans MJ actif :
 * l'avertissement `noGm` (clé de traduction, s'il y en a une) et `fallback`. Une requête sans réponse (délai, erreur) rend
 * `fallback`, journalisée sous `label` s'il est donné. Une erreur du traitement local, elle, remonte.
 * @param {string} query
 * @param {(payload: object) => any} handler
 * @param {object} payload
 * @param {{timeout?: number, noGm?: string|null, fallback?: any, label?: string|null}} [options]
 */
export async function viaActiveGM(query, handler, payload, { timeout=10000, noGm=null, fallback=null, label=null }={}) {
  const gm = game.users.activeGM;
  if ( !gm ) {
    if ( noGm ) ui.notifications.warn(loc(noGm));
    return fallback;
  }
  if ( gm.isSelf ) return handler(payload);
  return gm.query(query, payload, { timeout }).catch(err => {
    if ( label ) console.warn(`${MODULE_ID} | ${label}`, err);
    return fallback;
  });
}

/**
 * Un acte sur un document : ici si ce client le possède (`isOwner`), sinon par le MJ actif (`query`), sans avertissement. Pas de MJ
 * actif, ou pas de réponse : `fallback`.
 */
export async function viaOwnerOrGM(isOwner, query, handler, payload, { timeout=10000, fallback=null }={}) {
  if ( isOwner ) return handler(payload);
  const gm = game.users.activeGM;
  if ( !gm ) return fallback;
  return gm.query(query, payload, { timeout }).catch(() => fallback);
}

/** Au-delà, on juge sans attendre le canevas (et on le dit). */
export const CANVAS_WAIT_MAX_MS = 5000;

/**
 * Attend que le canevas ait fini de se dessiner (changement de niveau ou de scène : le cœur V14
 * redessine tout, `canvas.ready` faux le temps du redessin). Borné. Sans global : testable.
 * @param {object} ports
 * @param {() => boolean} ports.isReady
 * @param {(ms: number) => Promise} ports.sleep
 * @param {number} [maxMs]
 * @param {number} [stepMs]
 * @returns {() => Promise<boolean>}  true : prêt (tout de suite ou après attente) ; false : pas prêt à temps.
 */
export function createCanvasWait({ isReady, sleep }, maxMs=CANVAS_WAIT_MAX_MS, stepMs=50) {
  return async function whenCanvasReady() {
    for ( let waited = 0; !isReady(); waited += stepMs ) {
      if ( waited >= maxMs ) return false;
      await sleep(stepMs);
    }
    return true;
  };
}

export const whenCanvasReady = createCanvasWait({
  isReady: () => !!globalThis.canvas?.ready,
  sleep
});

/** Au-delà, on continue sans les dés 3D : une animation qui ne se joue pas ne retient pas le jeu. */
export const DICE_WAIT_MAX_MS = 8000;

/**
 * Principe 2 : rien ne s'applique avant que les dés se soient arrêtés. Dice So Nice reste optionnel,
 * et son attente est bornée (SPEC §12, blocage vu le 2026-09-22) : `waitFor3DAnimationByMessageID`
 * ne rend la main qu'au hook `diceSoNiceRollComplete` du message (main.js, 6.2.9), qui ne vient
 * jamais si le rendu est suspendu — fenêtre en arrière-plan, onglet masqué. Sans global : testable.
 * @param {object} ports
 * @param {(id: string) => Promise|null} ports.animation  Attente de l'animation d'un message ; null si pas de dés 3D.
 * @param {() => boolean} ports.isHidden                  La fenêtre est-elle sans rendu ?
 * @param {(ms: number) => Promise} ports.sleep
 * @param {(why: string) => void} [ports.report]          Consigne qu'on a continué sans attendre.
 * @param {number} [maxMs]
 */
export function createDiceWait({ animation, isHidden, sleep, report=() => {} }, maxMs=DICE_WAIT_MAX_MS) {
  return async function waitForDice(message) {
    if ( isHidden() ) return report("window in the background");   // sans rendu, l'animation ne se jouera pas
    const pending = animation(message.id);
    if ( !pending ) return;
    const outcome = await Promise.race([pending.then(() => "done"), sleep(maxMs).then(() => "late")]);
    if ( outcome === "late" ) report(`over ${maxMs} ms`);
  };
}

export const waitForDice = createDiceWait({
  animation: id => (game.modules.get("dice-so-nice")?.active && game.dice3d) ? game.dice3d.waitFor3DAnimationByMessageID(id) : null,
  isHidden: () => document.hidden === true,
  sleep,
  report: why => log(`3D dice: continuing without waiting (${why})`)
});

/**
 * §252 : lancer un jet de dnd5e (`roll`, qui rend ses jets) puis attendre la fin des dés 3D de son message (`waitForDice`, borné) avant de
 * rendre la main — le verdict ne part qu'après. dnd5e ne rend que les jets : le message est le dernier message de jet de ce client créé
 * pendant le jet.
 */
export async function rolledAndShown(roll) {
  const known = new Set(game.messages.keys());
  const rolls = await roll();
  const message = game.messages.contents.findLast(m => !known.has(m.id) && m.isAuthor && m.rolls?.length);
  if ( message ) await waitForDice(message);
  return rolls;
}

/** Le token (document) d'un acteur : celui d'un acteur de token, sinon le premier actif. */
export const tokenOfActor = actor => actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;

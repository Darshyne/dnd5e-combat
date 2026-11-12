/**
 * Les fenêtres du combat ne retiennent pas la partie (règle de table, demandée par l'utilisateur le
 * 2026-09-23) : réaction, choix de sauvegarde, choix d'effet, jet de sauvegarde d'un joueur — au bout du
 * délai (10 s par défaut, réglage de monde `combatWindowSeconds`), elles se résolvent seules. Un compte à
 * rebours visible le dit.
 *
 * Sur `DialogV2.wait` du cœur (client/applications/api/dialog.mjs:405) : `render` donne la fenêtre (le
 * compteur, la fermeture au bout du délai), `close` choisit ce que rend une fenêtre fermée — la réponse
 * par défaut si c'est le délai qui l'a fermée, null sinon.
 *
 * §290 : réglage de monde `combatWindowUnlimited` — les fenêtres n'ont plus de délai, le joueur prend son temps, et le MJ voit qui il
 * attend (ui/player-waits.mjs) ; « Forcer » fait sur le client du joueur ce que le délai aurait fait (`forceOpenWindows`). Un délai
 * donné explicitement (jets demandés par le MJ, §242) n'est pas touché.
 */

import { MODULE_ID } from "../constants.mjs";
import { markAwaiting } from "./awaiting.mjs";
import { createWindowLine } from "../core/window-line.mjs";

/** Délai des fenêtres du combat, en secondes. */
export function combatWindowSeconds() {
  try { return Math.max(3, Number(game.settings.get(MODULE_ID, "combatWindowSeconds")) || 10); }
  catch { return 10; }
}

/** §290 : les fenêtres du combat sont-elles sans délai (le MJ force) ? */
export function windowsUnlimited() {
  try { return !!game.settings.get(MODULE_ID, "combatWindowUnlimited"); }
  catch { return false; }
}

/** §290 : sur ce client, ce que le délai ferait à chaque fenêtre ouverte sans délai. */
const forcers = new Set();

/** §290 : le MJ force — chaque fenêtre du combat ouverte sur ce client se résout comme au bout du délai. Rend leur nombre. */
export function forceOpenWindows() {
  const all = [...forcers];
  forcers.clear();
  for ( const force of all ) {
    try { force(); }
    catch(err) { console.warn(`${MODULE_ID} | forced window`, err); }
  }
  return all.length;
}

/**
 * Au bout du délai (`ms`), ou quand le MJ force si les fenêtres sont sans délai : `expire`. Rend la fonction qui désarme.
 * @param {Function} expire
 * @param {number} ms
 * @param {boolean} [unlimited]  Sans délai (par défaut : le réglage).
 */
export function expireLater(expire, ms, unlimited=windowsUnlimited()) {
  // §381 : le MJ peut aussi forcer une fenêtre à délai (menu du token) ; elle se résout alors tout de suite, comme au bout du délai.
  let done = false;
  const once = () => { if ( done ) return; done = true; forcers.delete(once); clearTimeout(timer); expire(); };
  const timer = unlimited ? null : setTimeout(once, ms);
  forcers.add(once);
  return () => { done = true; clearTimeout(timer); forcers.delete(once); };
}

const countdownText = n => game.i18n.format("DND5ECOMBAT.Delai.Auto", { n });

/* -------------------------------------------- */
/*  §422 : les fenêtres ouvertes sur ce poste    */
/* -------------------------------------------- */

/**
 * §422 : sur ce client, quand une fenêtre du moteur s'y ouvre ou s'y ferme : `(prompts)`, `[{ id, awaitingId, actor, title, text,
 * buttons: [{ action, label, icon }], since }]`. Local : rien n'est diffusé (le texte d'une fenêtre ne quitte pas le poste où elle est
 * ouverte). La File du MJ s'en sert pour répondre depuis son panneau ; la même liste : `localPrompts()`.
 */
export const PROMPTS_HOOK = `${MODULE_ID}.localPrompts`;

const prompts = new Map();

/** Les fenêtres du moteur ouvertes sur ce poste, la plus ancienne d'abord. */
export function localPrompts() {
  return [...prompts.values()].map(({ choose, ...p }) => p).sort((a, b) => a.since - b.since);
}

/** Répond à la fenêtre `id` en cliquant son bouton `action` — exactement ce que ferait la souris. Rend false si elle n'existe plus. */
export function answerPrompt(id, action) {
  return prompts.get(id)?.choose(action) ?? false;
}

function trackPrompt(dialog, config, { awaitingId=null, actor=null }={}) {
  const id = awaitingId ?? foundry.utils.randomID();
  const text = document.createElement("div");
  text.innerHTML = config.content ?? "";
  prompts.set(id, {
    id, awaitingId, actor: actor?.uuid ?? null, title: config.window?.title ?? "", text: text.textContent.replace(/\s+/g, " ").trim(),
    buttons: (config.buttons ?? []).map(b => ({ action: b.action, label: b.label ?? b.action, icon: b.icon ?? null })), since: Date.now(),
    choose: action => {
      const button = [...(dialog.element?.querySelectorAll("button[data-action]") ?? [])].find(b => b.dataset.action === action);
      if ( !button ) return false;
      button.click();
      return true;
    }
  });
  Hooks.callAll(PROMPTS_HOOK, localPrompts());
  return () => { if ( prompts.delete(id) ) Hooks.callAll(PROMPTS_HOOK, localPrompts()); };
}

/** §422 : la ligne « N autres demandes ensuite » d'une fenêtre ouverte — ce qui attend son tour dans la file de ce poste. */
const QUEUED = `<p class="dnd5e-combat-queued" hidden></p>`;
function showQueued(dialog) {
  const line = dialog.element?.querySelector(".dnd5e-combat-queued");
  if ( !line ) return;
  const n = inLine.waiting();
  line.hidden = n === 0;
  line.textContent = n ? game.i18n.format(`DND5ECOMBAT.File.${n === 1 ? "EnsuiteUne" : "Ensuite"}`, { n }) : "";
}

/**
 * §422 : une fenêtre SANS délai (une décision du MJ, un refus), suivie comme les autres — sa ligne dans la File du MJ avec ses boutons,
 * et l'attente diffusée (`awaiting`) tant qu'elle est ouverte. `aside` : elle passe après la question en cours sur ce poste, sans
 * retenir les suivantes (core/window-line.mjs, `after`).
 * @param {object} config  Configuration de `DialogV2.wait`.
 * @param {{awaiting?: {actor: Actor|null, kind: string, token?: object}|null, aside?: boolean}} [options]
 * @returns {Promise<*>}  Le bouton choisi ; null si on la ferme.
 */
export function promptWait(config, { awaiting=null, aside=false }={}) {
  const open = () => {
    const release = awaiting ? markAwaiting(awaiting.actor ?? null, awaiting.kind, { token: awaiting.token ?? null }) : null;
    let untrack = () => {};
    return foundry.applications.api.DialogV2.wait({
      ...config,
      rejectClose: false,
      render: (event, dialog) => { untrack(); untrack = trackPrompt(dialog, config, { awaitingId: release?.id ?? null, actor: awaiting?.actor ?? null }); }
    }).finally(() => { untrack(); release?.(); });
  };
  return aside ? inLine.after(open, `promptWait: ${config?.window?.title ?? ""}`) : open();
}

/**
 * Une fenêtre à boutons qui se résout seule au bout du délai.
 * @param {object} config           Configuration de `DialogV2.wait` (window, content, buttons…).
 * @param {object} [options]
 * @param {*} [options.fallback]    Ce que rend la fenêtre si le délai l'a fermée (l'action d'un bouton…).
 * @param {number} [options.seconds]  Un délai propre ; sans lui, le réglage du monde (§290 : peut-être sans délai).
 * @param {boolean} [options.front]  §282 : la fenêtre passe devant les autres à son ouverture.
 * @param {{actor: Actor|null, kind: string, token?: object}|null} [options.awaiting]  §381 : la table voit qu'on attend cette créature
 *   (sablier au-dessus de son token) tant que la fenêtre est ouverte.
 * @returns {Promise<*>}  Le bouton choisi ; `fallback` au bout du délai (ou forcée par le MJ) ; null si on la ferme soi-même.
 */
export function timedWait(config, { fallback=null, seconds=null, front=false, awaiting=null }={}) {
  const unlimited = (seconds === null) && windowsUnlimited();
  const shown = unlimited ? null : (seconds ?? combatWindowSeconds());
  // §401 : à son tour — la fenêtre s'ouvre quand la précédente de ce poste est fermée ; son compte à rebours part à l'ouverture.
  return inLine(() => {
    const release = awaiting ? markAwaiting(awaiting.actor ?? null, awaiting.kind, { seconds: shown, token: awaiting.token ?? null }) : null;
    const track = { awaitingId: release?.id ?? null, actor: awaiting?.actor ?? null };
    const waiting = unlimited ? waitForForce(config, { fallback, front, track }) : countdownWait(config, { fallback, seconds: shown, front, track });
    return release ? waiting.finally(release) : waiting;
  }, `timedWait: ${config?.window?.title ?? ""}`);
}

/**
 * §401 : la file des fenêtres de ce poste (core/window-line.mjs) — les questions du moteur s'enchaînent au lieu de s'empiler. Une fenêtre
 * n'attend la précédente qu'un temps borné (le délai des fenêtres et 3 s ; 30 s quand elles sont sans délai) : au-delà, elle s'ouvre quand
 * même, pour qu'une question qui dépendrait d'une autre restée ouverte ne bloque jamais la partie.
 */
export const inLine = createWindowLine({ capMs: () => (windowsUnlimited() ? 30000 : (combatWindowSeconds() + 3) * 1000) });

/** Une fenêtre à compte à rebours : `fallback` au bout de `seconds`. */
function countdownWait(config, { fallback, seconds, front, track={} }) {
  let left = seconds;
  let timer = null;
  let timedOut = false;
  let disarm = () => {};
  let untrack = () => {};
  // Barre de progression menée par le même minuteur que la fermeture (une animation CSS sur la durée
  // dérive d'avec lui dans un onglet en arrière-plan) : à chaque seconde, elle part vers la valeur de la
  // seconde suivante, avec une transition d'une seconde — fluide, et vide au moment où la fenêtre se ferme.
  const update = dialog => {
    const root = dialog.element?.querySelector(".dnd5e-combat-countdown");
    if ( !root ) return;
    const ratio = Math.max(0, left - 1) / seconds;
    root.querySelector(".bar")?.style.setProperty("transform", `scaleX(${ratio})`);
    root.dataset.level = ratio > 0.6 ? "high" : ratio > 0.3 ? "mid" : "low";
    const label = root.querySelector(".label");
    if ( label ) label.textContent = countdownText(left);
  };
  const countdown = `<div class="dnd5e-combat-countdown" data-level="high">
    <div class="track"><div class="bar"></div></div><span class="label">${countdownText(left)}</span></div>`;
  return foundry.applications.api.DialogV2.wait({
    ...config,
    classes: [...(config.classes ?? []), "dnd5e-combat-timed"],
    content: `${config.content ?? ""}${countdown}${QUEUED}`,
    rejectClose: false,
    render: (event, dialog) => {
      if ( front ) dialog.bringToFront?.();
      if ( timer ) return;
      untrack = trackPrompt(dialog, config, track);
      showQueued(dialog);
      // §381 : le MJ force (menu du token) — comme au bout du délai.
      disarm = expireLater(() => { clearInterval(timer); timedOut = true; dialog.close(); }, 0, true);
      requestAnimationFrame(() => update(dialog));   // après la première peinture, sinon pas de transition
      timer = setInterval(() => {
        left -= 1;
        update(dialog);
        showQueued(dialog);
        if ( left > 0 ) return;
        clearInterval(timer);
        timedOut = true;
        dialog.close();
      }, 1000);
    },
    close: () => {
      clearInterval(timer);
      disarm();
      untrack();
      return timedOut ? fallback : null;
    }
  });
}

/** §290 : une fenêtre sans délai — elle attend le joueur ; le MJ peut la forcer (elle rend alors `fallback`). */
function waitForForce(config, { fallback, front, track={} }) {
  let forced = false;
  let disarm = () => {};
  let untrack = () => {};
  let queued = null;
  const waiting = `<p class="dnd5e-combat-waiting"><i class="fa-solid fa-hourglass-half"></i> ${game.i18n.localize("DND5ECOMBAT.Attente.Joueur")}</p>`;
  return foundry.applications.api.DialogV2.wait({
    ...config,
    classes: [...(config.classes ?? []), "dnd5e-combat-timed"],
    content: `${config.content ?? ""}${waiting}${QUEUED}`,
    rejectClose: false,
    render: (event, dialog) => {
      if ( front ) dialog.bringToFront?.();
      untrack();
      untrack = trackPrompt(dialog, config, track);
      showQueued(dialog);
      clearInterval(queued);
      queued = setInterval(() => showQueued(dialog), 1000);
      disarm();
      disarm = expireLater(() => { forced = true; dialog.close(); }, 0, true);
    },
    close: () => {
      disarm();
      untrack();
      clearInterval(queued);
      return forced ? fallback : null;
    }
  });
}

/**
 * Ferme au bout du délai la fenêtre de jet de dnd5e d'un acteur (jet de sauvegarde d'un joueur) ; rend
 * une fonction pour annuler le minuteur. `onTimeout` est appelé si c'est le délai qui l'a fermée.
 * §290 : sans délai propre et fenêtres sans délai, c'est le MJ qui la ferme en forçant.
 * §381 : `awaiting` (une sorte, « roll ») — la table voit qu'on attend ce jet tant que le minuteur n'est ni échu ni annulé.
 */
export function closeRollDialogAfter(actor, onTimeout, seconds=null, { awaiting=null }={}) {
  const unlimited = (seconds === null) && windowsUnlimited();
  seconds ??= combatWindowSeconds();
  // §381 : la table voit qu'on attend ce jet, jusqu'à ce qu'il parte ou que la fenêtre soit fermée.
  const release = (awaiting && (seconds > 0)) ? markAwaiting(actor, awaiting, { seconds: unlimited ? null : seconds }) : () => {};
  const disarm = expireLater(() => {
    release();
    const Dialog = globalThis.dnd5e?.applications?.dice?.RollConfigurationDialog;
    for ( const app of foundry.applications.instances.values() ) {
      if ( !(app instanceof Dialog) || !app.rendered ) continue;
      const subject = app.config?.subject;
      if ( (subject === actor) || (subject?.uuid === actor.uuid) || (subject?.actor === actor) ) {
        onTimeout();
        app.close();
      }
    }
  }, seconds * 1000, unlimited);
  return () => { release(); disarm(); };
}

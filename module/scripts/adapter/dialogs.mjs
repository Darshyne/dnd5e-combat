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
  if ( !unlimited ) {
    const timer = setTimeout(expire, ms);
    return () => clearTimeout(timer);
  }
  forcers.add(expire);
  return () => forcers.delete(expire);
}

const countdownText = n => game.i18n.format("DND5ECOMBAT.Delai.Auto", { n });

/**
 * Une fenêtre à boutons qui se résout seule au bout du délai.
 * @param {object} config           Configuration de `DialogV2.wait` (window, content, buttons…).
 * @param {object} [options]
 * @param {*} [options.fallback]    Ce que rend la fenêtre si le délai l'a fermée (l'action d'un bouton…).
 * @param {number} [options.seconds]  Un délai propre ; sans lui, le réglage du monde (§290 : peut-être sans délai).
 * @param {boolean} [options.front]  §282 : la fenêtre passe devant les autres à son ouverture.
 * @returns {Promise<*>}  Le bouton choisi ; `fallback` au bout du délai (ou forcée par le MJ) ; null si on la ferme soi-même.
 */
export function timedWait(config, { fallback=null, seconds=null, front=false }={}) {
  if ( (seconds === null) && windowsUnlimited() ) return waitForForce(config, { fallback, front });
  seconds ??= combatWindowSeconds();
  let left = seconds;
  let timer = null;
  let timedOut = false;
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
    content: `${config.content ?? ""}${countdown}`,
    rejectClose: false,
    render: (event, dialog) => {
      if ( front ) dialog.bringToFront?.();
      if ( timer ) return;
      requestAnimationFrame(() => update(dialog));   // après la première peinture, sinon pas de transition
      timer = setInterval(() => {
        left -= 1;
        update(dialog);
        if ( left > 0 ) return;
        clearInterval(timer);
        timedOut = true;
        dialog.close();
      }, 1000);
    },
    close: () => {
      clearInterval(timer);
      return timedOut ? fallback : null;
    }
  });
}

/** §290 : une fenêtre sans délai — elle attend le joueur ; le MJ peut la forcer (elle rend alors `fallback`). */
function waitForForce(config, { fallback, front }) {
  let forced = false;
  let disarm = () => {};
  const waiting = `<p class="dnd5e-combat-waiting"><i class="fa-solid fa-hourglass-half"></i> ${game.i18n.localize("DND5ECOMBAT.Attente.Joueur")}</p>`;
  return foundry.applications.api.DialogV2.wait({
    ...config,
    classes: [...(config.classes ?? []), "dnd5e-combat-timed"],
    content: `${config.content ?? ""}${waiting}`,
    rejectClose: false,
    render: (event, dialog) => {
      if ( front ) dialog.bringToFront?.();
      disarm();
      disarm = expireLater(() => { forced = true; dialog.close(); }, 0, true);
    },
    close: () => {
      disarm();
      return forced ? fallback : null;
    }
  });
}

/**
 * Ferme au bout du délai la fenêtre de jet de dnd5e d'un acteur (jet de sauvegarde d'un joueur) ; rend
 * une fonction pour annuler le minuteur. `onTimeout` est appelé si c'est le délai qui l'a fermée.
 * §290 : sans délai propre et fenêtres sans délai, c'est le MJ qui la ferme en forçant.
 */
export function closeRollDialogAfter(actor, onTimeout, seconds=null) {
  const unlimited = (seconds === null) && windowsUnlimited();
  seconds ??= combatWindowSeconds();
  return expireLater(() => {
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
}

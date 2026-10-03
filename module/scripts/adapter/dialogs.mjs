/**
 * Les fenêtres du combat ne retiennent pas la partie (règle de table, demandée par l'utilisateur le
 * 2026-09-23) : réaction, choix de sauvegarde, choix d'effet, jet de sauvegarde d'un joueur — au bout du
 * délai (10 s par défaut, réglage de monde `combatWindowSeconds`), elles se résolvent seules. Un compte à
 * rebours visible le dit.
 *
 * Sur `DialogV2.wait` du cœur (client/applications/api/dialog.mjs:405) : `render` donne la fenêtre (le
 * compteur, la fermeture au bout du délai), `close` choisit ce que rend une fenêtre fermée — la réponse
 * par défaut si c'est le délai qui l'a fermée, null sinon.
 */

import { MODULE_ID } from "../constants.mjs";

/** Délai des fenêtres du combat, en secondes. */
export function combatWindowSeconds() {
  try { return Math.max(3, Number(game.settings.get(MODULE_ID, "combatWindowSeconds")) || 10); }
  catch { return 10; }
}

const countdownText = n => game.i18n.format("DND5ECOMBAT.Delai.Auto", { n });

/**
 * Une fenêtre à boutons qui se résout seule au bout du délai.
 * @param {object} config           Configuration de `DialogV2.wait` (window, content, buttons…).
 * @param {object} [options]
 * @param {*} [options.fallback]    Ce que rend la fenêtre si le délai l'a fermée (l'action d'un bouton…).
 * @param {number} [options.seconds]
 * @returns {Promise<*>}  Le bouton choisi ; `fallback` au bout du délai ; null si on la ferme soi-même.
 */
export function timedWait(config, { fallback=null, seconds=combatWindowSeconds() }={}) {
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

/**
 * Ferme au bout du délai la fenêtre de jet de dnd5e d'un acteur (jet de sauvegarde d'un joueur) ; rend
 * une fonction pour annuler le minuteur. `onTimeout` est appelé si c'est le délai qui l'a fermée.
 */
export function closeRollDialogAfter(actor, onTimeout, seconds=combatWindowSeconds()) {
  const timer = setTimeout(() => {
    const Dialog = globalThis.dnd5e?.applications?.dice?.RollConfigurationDialog;
    for ( const app of foundry.applications.instances.values() ) {
      if ( !(app instanceof Dialog) || !app.rendered ) continue;
      const subject = app.config?.subject;
      if ( (subject === actor) || (subject?.uuid === actor.uuid) || (subject?.actor === actor) ) {
        onTimeout();
        app.close();
      }
    }
  }, seconds * 1000);
  return () => clearTimeout(timer);
}

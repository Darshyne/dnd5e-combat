/**
 * §364 : alerte MJ, côté écran — chaque carte d'alerte (runtime/gm-alert.mjs) s'affiche aussi chez chaque MJ dans un bandeau en haut de
 * l'écran, aux couleurs de DAS : le nom de l'objet et ce qu'il reste à gérer. Plusieurs alertes s'empilent ; un clic en ferme une ;
 * elles partent seules après `gmAlertSeconds` (0 : au clic seulement). Réglages de ce poste : `gmAlertBanner`, `gmAlertSeconds`.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { esc, loc } from "../runtime/shared.mjs";

export const GM_ALERT_BANNER_SETTING = "gmAlertBanner";
export const GM_ALERT_SECONDS_SETTING = "gmAlertSeconds";

let stack = null;

function container() {
  if ( stack?.isConnected ) return stack;
  stack = document.createElement("div");
  stack.className = "das-gm-alerts";
  stack.setAttribute("role", "alert");
  document.body.append(stack);
  return stack;
}

/** Montre une alerte dans le bandeau ; rend l'élément. */
export function showGmAlert({ text, item=null, actor=null }) {
  const line = document.createElement("div");
  line.className = "das-gm-alerts__line";
  line.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`
    + `<span class="das-gm-alerts__body"><span class="das-gm-alerts__title">${esc(loc("AlerteMJ.Titre"))}${item ? ` · ${esc(item)}` : ""}${actor ? ` (${esc(actor)})` : ""}</span>`
    + `<span class="das-gm-alerts__text">${esc(text)}</span></span><i class="fa-solid fa-xmark das-gm-alerts__close"></i>`;
  line.dataset.tooltip = loc("AlerteMJ.Fermer");
  const close = () => { line.classList.add("closing"); setTimeout(() => line.remove(), 250); };
  line.addEventListener("click", close);
  container().append(line);
  const seconds = Number(game.settings.get(MODULE_ID, GM_ALERT_SECONDS_SETTING)) || 0;
  if ( seconds > 0 ) setTimeout(close, seconds * 1000);
  return line;
}

function onMessage(message) {
  const alert = message.getFlag?.(MODULE_ID, "gmAlert");
  if ( !alert || !game.user.isGM || !game.settings.get(MODULE_ID, GM_ALERT_BANNER_SETTING) ) return;
  showGmAlert(alert);
}

export function registerGmAlertUi() {
  const client = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  client(GM_ALERT_BANNER_SETTING, { type: Boolean, default: true });
  client(GM_ALERT_SECONDS_SETTING, { type: Number, default: 15, range: { min: 0, max: 120, step: 5 } });
  route("createChatMessage", onMessage, { label: "GM alert: banner not shown" });
}

/**
 * §290 : la fenêtre de suivi du MJ quand les fenêtres du combat sont sans délai — qui il attend, pour quel personnage, quoi, depuis
 * combien de temps, et « Forcer » (runtime/player-waits.mjs). Elle s'ouvre d'elle-même chez un MJ quand une attente dépasse le délai des
 * fenêtres du combat (le curseur du réglage, qui ne ferme plus rien dans ce mode), se ferme quand il n'en reste aucune ; `api.waits.open()`
 * la rouvre. Seul le client qui pose les questions (le MJ actif) a des attentes à montrer.
 */

import { MODULE_ID } from "../constants.mjs";
import { PLAYER_WAITS_HOOK, playerWaits } from "../adapter/player-wait.mjs";
import { combatWindowSeconds, windowsUnlimited } from "../adapter/dialogs.mjs";
import { forceWait } from "../runtime/player-waits.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const WINDOW_ID = "das-player-waits";
/** Les attentes que le MJ a écartées de la fenêtre (elle ne se rouvre pas pour elles). */
const dismissed = new Set();
let tick = null;
let opener = null;

const elapsed = since => Math.max(0, Math.round((Date.now() - since) / 1000));

let WaitsClass = null;
const WaitsApp = () => WaitsClass ??= class PlayerWaits extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-player-waits"],
    window: { icon: "fa-solid fa-hourglass-half", resizable: true },
    position: { width: 420, height: "auto" },
    actions: { force: PlayerWaits.#force, forceAll: PlayerWaits.#forceAll }
  };

  get title() {
    return loc("Attente.Titre");
  }

  async _renderHTML() {
    const waits = playerWaits();
    if ( !waits.length ) return `<p class="das-muted">${esc(loc("Attente.Aucune"))}</p>`;
    const rows = waits.map(w => `<li class="das-wait">
      <img src="${esc(w.img ?? "icons/svg/mystery-man.svg")}" alt="">
      <div class="das-wait__text"><strong>${esc(w.userName)}</strong>${w.actorName ? ` <span class="das-muted">(${esc(w.actorName)})</span>` : ""}
        <small>${esc(w.label)}</small></div>
      <span class="das-wait__time" data-since="${w.since}">${esc(loc("Attente.Depuis", { n: elapsed(w.since) }))}</span>
      <button type="button" data-action="force" data-id="${esc(w.id)}" data-tooltip="${esc(loc("Attente.ForcerAide"))}">
        <i class="fa-solid fa-forward"></i>${esc(loc("Attente.Forcer"))}</button>
    </li>`).join("");
    const all = waits.length > 1 ? `<footer><button type="button" data-action="forceAll"><i class="fa-solid fa-forward-fast"></i>
      ${esc(loc("Attente.ForcerTout", { count: waits.length }))}</button></footer>` : "";
    return `<ul class="das-waits">${rows}</ul>${all}`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender() {
    // Le temps d'attente avance chaque seconde, sans tout redessiner.
    clearInterval(tick);
    tick = setInterval(() => {
      for ( const el of this.element?.querySelectorAll(".das-wait__time") ?? [] ) {
        el.textContent = loc("Attente.Depuis", { n: elapsed(Number(el.dataset.since)) });
      }
    }, 1000);
  }

  _onClose() {
    clearInterval(tick);
    tick = null;
    for ( const w of playerWaits() ) dismissed.add(w.id);
  }

  static async #force(event, target) {
    target.disabled = true;
    await forceWait(target.dataset.id);
  }

  static async #forceAll(event, target) {
    target.disabled = true;
    for ( const w of playerWaits() ) await forceWait(w.id);
  }
};

/** Ouvre (ou ramène devant) la fenêtre de suivi, MJ seulement. */
export function openPlayerWaits() {
  if ( !game.user.isGM ) return null;
  const open = foundry.applications.instances.get(WINDOW_ID);
  if ( open ) {
    open.render({ force: true });
    open.bringToFront?.();
    return open;
  }
  const app = new (WaitsApp())();
  app.render({ force: true });
  return app;
}

/**
 * Une attente a commencé ou fini : la fenêtre ouverte se redessine (et se ferme quand il n'y en a plus) ; sinon, elle s'ouvre quand la
 * plus ancienne attente non écartée dépasse le délai des fenêtres.
 */
function onWaitsChanged(waits) {
  if ( !game.user.isGM ) return;
  const app = foundry.applications.instances.get(WINDOW_ID);
  clearTimeout(opener);
  for ( const id of [...dismissed] ) if ( !waits.some(w => w.id === id) ) dismissed.delete(id);
  if ( app ) return waits.length ? app.render() : app.close();
  const pending = waits.filter(w => !dismissed.has(w.id));
  if ( !pending.length || !windowsUnlimited() ) return;
  const due = pending[0].since + (combatWindowSeconds() * 1000) - Date.now();
  opener = setTimeout(() => {
    if ( playerWaits().some(w => !dismissed.has(w.id)) ) openPlayerWaits();
  }, Math.max(0, due));
}

export function registerPlayerWaitsUI() {
  route(PLAYER_WAITS_HOOK, onWaitsChanged, { always: true, label: "player waits: GM window not refreshed" });
}

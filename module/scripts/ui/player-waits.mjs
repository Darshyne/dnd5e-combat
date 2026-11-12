/**
 * §421 : le panneau « File du MJ » (l'ancienne fenêtre de suivi du §290) — en trois parts, ce que le moteur demande au MJ, les joueurs
 * qu'il attend (qui, pour quel personnage, quoi, depuis combien de temps, « Forcer »), et les actions bloquées par un auteur parti
 * (« Lancer à sa place »). La file elle-même : runtime/gm-queue.mjs.
 *
 * Il s'ouvre de lui-même chez un MJ quand la partie est retenue : une action bloquée, ou un joueur attendu au-delà du délai des fenêtres
 * du combat (possible seulement quand elles sont sans délai — avec un délai, elles se résolvent seules). Il se ferme quand il ne reste
 * plus rien ; `api.queue.open()` (ou `api.waits.open()`) le rouvre. Les fenêtres du MJ continuent de s'ouvrir comme avant : le panneau en
 * tient la liste, il ne les remplace pas.
 */

import { GM_QUEUE_HOOK, queue, forceLine, rollBlocked } from "../runtime/gm-queue.mjs";
import { combatWindowSeconds, windowsUnlimited } from "../adapter/dialogs.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const WINDOW_ID = "das-player-waits";
/** Les lignes que le MJ a écartées en fermant le panneau (il ne se rouvre pas pour elles). */
const dismissed = new Set();
let tick = null;
let opener = null;

const elapsed = since => Math.max(0, Math.round((Date.now() - since) / 1000));
/** Le nom et l'image du personnage d'une ligne (lus sur ce client : la ligne ne porte que son uuid). */
const actorOf = line => (line.actor ? fromUuidSync(line.actor, { strict: false }) : null);
const what = line => line.label || loc(`File.Sorte.${line.kind}`);

function row(line, button) {
  const actor = actorOf(line);
  return `<li class="das-wait">
    <img src="${esc(actor?.img ?? "icons/svg/mystery-man.svg")}" alt="">
    <div class="das-wait__text"><strong>${esc(line.userName)}</strong>${actor?.name ? ` <span class="das-muted">(${esc(actor.name)})</span>` : ""}
      <small>${esc(what(line))}</small></div>
    <span class="das-wait__time" data-since="${line.since}">${esc(loc("Attente.Depuis", { n: elapsed(line.since) }))}</span>
    ${button}
  </li>`;
}

let WaitsClass = null;
const WaitsApp = () => WaitsClass ??= class PlayerWaits extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-player-waits"],
    window: { icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 440, height: "auto" },
    actions: { force: PlayerWaits.#force, forceAll: PlayerWaits.#forceAll, roll: PlayerWaits.#roll }
  };

  get title() {
    return loc("Attente.Titre");
  }

  async _renderHTML() {
    const q = queue();
    if ( !q.count ) return `<p class="das-muted">${esc(loc("Attente.Aucune"))}</p>`;
    const section = (title, rows) => (rows.length ? `<h4 class="das-queue__title">${esc(loc(title))}</h4><ul class="das-waits">${rows.join("")}</ul>` : "");
    const mine = q.mine.map(l => row(l, `<span class="das-muted das-wait__note" data-tooltip="${esc(loc("File.MaFenetre"))}"><i class="fa-solid fa-window-restore"></i></span>`));
    const players = q.players.map(l => row(l, `<button type="button" data-action="force" data-id="${esc(l.id)}" data-tooltip="${esc(loc("Attente.ForcerAide"))}">
      <i class="fa-solid fa-forward"></i>${esc(loc("Attente.Forcer"))}</button>`));
    const blocked = q.blocked.map(b => `<li class="das-wait das-wait--blocked">
      <img src="${esc(actorOf(b)?.img ?? "icons/svg/mystery-man.svg")}" alt="">
      <div class="das-wait__text"><strong>${esc(loc("File.Parti", { name: b.userName }))}</strong>
        <small>${esc(loc(b.heal ? "File.Soin" : "File.Jet", { item: b.item }))}${b.actorName ? ` — ${esc(b.actorName)}` : ""}</small></div>
      <button type="button" data-action="roll" data-id="${esc(b.id)}" data-tooltip="${esc(loc("File.LancerAide"))}">
        <i class="fa-solid fa-dice-d20"></i>${esc(loc("File.Lancer"))}</button>
    </li>`);
    const all = q.players.length > 1 ? `<footer><button type="button" data-action="forceAll"><i class="fa-solid fa-forward-fast"></i>
      ${esc(loc("Attente.ForcerTout", { count: q.players.length }))}</button></footer>` : "";
    return `${section("File.Bloque", blocked)}${section("File.Moi", mine)}${section("File.Joueurs", players)}${all}`;
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
    const q = queue();
    for ( const l of [...q.players, ...q.blocked] ) dismissed.add(l.id);
  }

  static async #force(event, target) {
    target.disabled = true;
    await forceLine(target.dataset.id);
  }

  static async #forceAll(event, target) {
    target.disabled = true;
    for ( const l of queue().players ) await forceLine(l.id);
  }

  static async #roll(event, target) {
    target.disabled = true;
    await rollBlocked(target.dataset.id);
  }
};

/** Ouvre (ou ramène devant) le panneau « File du MJ », MJ seulement. */
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
 * La file a changé : le panneau ouvert se redessine (et se ferme quand elle est vide) ; sinon il s'ouvre quand la partie est retenue —
 * une action bloquée tout de suite, un joueur attendu au-delà du délai des fenêtres (fenêtres sans délai seulement). Les demandes faites
 * au MJ lui-même n'ouvrent pas le panneau : leur fenêtre est déjà devant lui.
 */
function onQueueChanged(q) {
  if ( !game.user.isGM ) return;
  const app = foundry.applications.instances.get(WINDOW_ID);
  clearTimeout(opener);
  const held = [...q.players, ...q.blocked];
  for ( const id of [...dismissed] ) if ( !held.some(l => l.id === id) ) dismissed.delete(id);
  if ( app ) return q.count ? app.render() : app.close();
  if ( !windowsUnlimited() ) return;   // avec un délai, rien ne retient la partie : la fenêtre se résout, le jet d'un absent est lancé
  if ( q.blocked.some(l => !dismissed.has(l.id)) ) return void openPlayerWaits();
  const pending = q.players.filter(l => !dismissed.has(l.id));
  if ( !pending.length ) return;
  const due = pending[0].since + (combatWindowSeconds() * 1000) - Date.now();
  opener = setTimeout(() => {
    if ( queue().players.some(l => !dismissed.has(l.id)) ) openPlayerWaits();
  }, Math.max(0, due));
}

export function registerPlayerWaitsUI() {
  route(GM_QUEUE_HOOK, onQueueChanged, { always: true, label: "GM queue: panel not refreshed" });
}

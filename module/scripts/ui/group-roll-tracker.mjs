/**
 * §242 : la fenêtre de suivi du MJ — les jets demandés **en cours**, à la manière de la fenêtre du joueur (Combat UI) : par demande, le
 * libellé, le test, le DD, puis une carte par personnage, côte à côte — portrait, nom, joueur (point vert : connecté), un d20 (« ? » qui
 * pulse tant qu'il n'a pas lancé, puis le chiffre sorti), le total, réussite ou échec, une flèche verte vers le haut pour l'Avantage, rouge
 * vers le bas pour le Désavantage (« forcé » quand le joueur l'a imposé), les aides accordées (portrait de l'aidant) et, tant qu'il n'a pas
 * lancé, « Lancer pour lui » — sa fenêtre se ferme chez son joueur (le jet arrive d'ailleurs, runtime/group-roll.mjs).
 *
 * Une demande terminée montre son verdict quelques secondes, puis quitte la liste (retour de l'utilisateur : « pas les jets précédents,
 * juste les tests en cours ») ; la fenêtre se ferme quand il n'en reste aucune. Elle s'ouvre d'elle-même chez le MJ qui fait une demande, et
 * depuis la fenêtre de demande (« Jets en cours ») ou `api.rolls.tracker()`.
 */

import { MODULE_ID } from "../constants.mjs";
import { requestOf, viewOf, testTitle } from "../adapter/group-roll.mjs";
import { forceGroupRoll } from "../runtime/group-roll.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const WINDOW_ID = "das-group-roll-tracker";
/** Une demande plus vieille que ça n'est plus suivie (elle reste dans la discussion). */
const RECENT_MS = 3 * 60 * 60 * 1000;
/** Une demande terminée reste affichée ce temps-là, avec son verdict. */
const DONE_KEEP_MS = 6000;
/** Les demandes retirées à la main, sur ce client. */
const dismissed = new Set();

const AID_KEYS = { guidance: "JetGroupe.Suivi.AideAssistance", inspiration: "JetGroupe.Suivi.AideInspiration", help: "JetGroupe.Suivi.AideSoutien" };

/** Le moment où une demande a été achevée (son dernier jet), ou null tant qu'elle ne l'est pas. */
function finishedAt(view) {
  if ( !view.done ) return null;
  return Math.max(0, ...view.entries.map(e => game.messages.get(e.message)?.timestamp ?? 0));
}

/** Les demandes en cours (et celles qui viennent de finir), la plus récente d'abord. */
function trackedViews() {
  const since = Date.now() - RECENT_MS;
  return game.messages.contents.filter(m => requestOf(m) && (m.timestamp >= since) && !dismissed.has(m.id)).reverse()
    .map(m => viewOf(m)).filter(view => {
      if ( !view ) return false;
      const end = finishedAt(view);
      return (end === null) || ((Date.now() - end) < DONE_KEEP_MS);
    });
}

/** Le d20 de la fenêtre du joueur, en petit : la valeur au centre (« ? » tant qu'il n'a pas lancé). */
function d20Svg(value, waiting) {
  const hex = "50,4 90,27 90,73 50,96 10,73 10,27";
  const tri = "50,24 78,68 22,68";
  const edges = [[50, 24, 50, 4], [50, 24, 10, 27], [50, 24, 90, 27], [22, 68, 10, 27], [22, 68, 10, 73], [22, 68, 50, 96],
    [78, 68, 90, 27], [78, 68, 90, 73], [78, 68, 50, 96]].map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join("");
  return `<svg class="das-tracker__d20${waiting ? " waiting" : ""}" viewBox="0 0 100 100" aria-hidden="true">
    <polygon class="face" points="${hex}"/><g class="edges">${edges}</g><polygon class="inner" points="${tri}"/>
    <text x="50" y="58">${esc(value)}</text></svg>`;
}

let TrackerClass = null;
const TrackerApp = () => TrackerClass ??= class GroupRollTracker extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-screen", "das-group-roll-tracker"],
    window: { icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      force: GroupRollTracker.#force,
      forceAll: GroupRollTracker.#forceAll,
      dismiss: GroupRollTracker.#dismiss
    }
  };

  get title() {
    return loc("JetGroupe.Suivi.Titre");
  }

  #person(view, entry) {
    const owners = entry.actor ? game.users.filter(u => !u.isGM && entry.actor.testUserPermission(u, "OWNER")) : [];
    const online = owners.some(u => u.active);
    const who = owners.length ? owners.map(u => esc(u.name)).join(", ") : esc(loc("JetGroupe.SansJoueur"));
    const rolled = entry.status === "rolled";
    const mode = [];
    if ( entry.advantage ) mode.push(`<i class="fa-solid fa-arrow-up das-tracker__adv" data-tooltip="${esc(loc("JetGroupe.Mode.advantage"))}"></i>`);
    if ( entry.disadvantage ) mode.push(`<i class="fa-solid fa-arrow-down das-tracker__dis" data-tooltip="${esc(loc("JetGroupe.Mode.disadvantage"))}"></i>`);
    if ( entry.forced ) mode.push(`<small>${esc(loc("JetGroupe.Suivi.Force"))}</small>`);
    const aids = (entry.aids ?? []).map(a => `<img class="das-tracker__aid" src="${esc(a.img ?? "icons/svg/mystery-man.svg")}" alt=""
      data-tooltip="${esc(loc(AID_KEYS[a.kind] ?? "JetGroupe.Suivi.AideSoutien", { name: a.helper }))}">`).join("");
    const outcome = (entry.success === true) ? "success" : (entry.success === false) ? "failure" : "";
    return `<article class="das-tracker__person ${rolled ? "rolled" : "waiting"} ${outcome}">
      <img class="das-tracker__portrait" src="${esc(entry.img ?? "icons/svg/mystery-man.svg")}" alt="">
      <strong class="das-tracker__name">${esc(entry.name)}</strong>
      <small class="das-tracker__player"><i class="fa-solid fa-circle ${online ? "online" : "offline"}"></i> ${who}</small>
      ${d20Svg(rolled || entry.deciding ? (entry.d20 ?? "") : "?", !rolled)}
      <div class="das-tracker__total">${rolled ? esc(entry.total)
        : entry.deciding ? `${esc(entry.rolled)}<span class="das-muted">${esc(loc("JetGroupe.Suivi.Decision"))}</span>`
        : `<span class="das-muted">${esc(loc("JetGroupe.Suivi.Attente"))}</span>`}
        ${outcome ? `<i class="fa-solid ${outcome === "success" ? "fa-check" : "fa-xmark"}"></i>` : ""}</div>
      <div class="das-tracker__mode">${mode.join("")}</div>
      <div class="das-tracker__aids">${aids}</div>
      ${(rolled || entry.deciding) ? "" : `<button type="button" class="das-tracker__force" data-action="force" data-card="${esc(view.id)}" data-actor="${esc(entry.uuid)}">
        <i class="fa-solid fa-dice-d20"></i>${esc(loc("JetGroupe.Suivi.LancerPour", { name: entry.name }))}</button>`}
    </article>`;
  }

  #request(view) {
    const r = view.request;
    const dc = (r.dc === null) ? "" : `<span class="das-tracker__dc">${esc(loc(r.hideDc ? "JetGroupe.CarteDDCacheMJ" : "JetGroupe.CarteDD", { dc: r.dc }))}</span>`;
    let verdict = "";
    if ( view.success !== null ) {
      const key = r.group ? (view.success ? "VerdictGroupeReussi" : "VerdictGroupeRate") : (view.success ? "VerdictReussi" : "VerdictRate");
      verdict = `<p class="das-tracker__ribbon ${view.success ? "success" : "failure"}">${esc(loc(`JetGroupe.${key}`,
        { successes: view.successes, count: view.entries.length }))}</p>`;
    }
    const waiting = view.entries.filter(e => e.status !== "rolled").length;
    return `<section class="das-tracker__request${view.done ? " done" : ""}">
      <header>
        ${r.label ? `<p class="das-tracker__label">${esc(r.label)}</p>` : ""}
        <h3>${esc(testTitle(r))}</h3>
        <p class="das-tracker__meta">${dc}${r.group ? `<span>${esc(loc("JetGroupe.CarteGroupe"))}</span>` : ""}
          <span>${esc(loc("JetGroupe.Suivi.Compte", { rolled: view.rolled, count: view.entries.length }))}</span></p>
        <button type="button" class="das-tracker__dismiss" data-action="dismiss" data-card="${esc(view.id)}"
          data-tooltip="${esc(loc("JetGroupe.Suivi.Retirer"))}"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="das-tracker__people">${view.entries.map(e => this.#person(view, e)).join("")}</div>
      ${verdict}
      ${waiting > 1 ? `<footer><button type="button" class="das-tracker__force all" data-action="forceAll" data-card="${esc(view.id)}">
        <i class="fa-solid fa-forward"></i>${esc(loc("JetGroupe.Suivi.LancerTous", { count: waiting }))}</button></footer>` : ""}
    </section>`;
  }

  async _renderHTML() {
    const views = trackedViews();
    // Une demande qui vient de finir quitte la liste après son verdict : un rendu de plus à ce moment-là.
    for ( const v of views ) {
      const end = finishedAt(v);
      if ( end !== null ) setTimeout(() => refresh(), Math.max(0, DONE_KEEP_MS - (Date.now() - end)) + 50);
    }
    return `<div class="das-tracker__body">
      ${views.length ? views.map(v => this.#request(v)).join("") : `<p class="das-muted">${esc(loc("JetGroupe.Suivi.Aucun"))}</p>`}
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #force(event, target) {
    target.disabled = true;
    await forceGroupRoll(target.dataset.card, target.dataset.actor);
  }

  static async #forceAll(event, target) {
    target.disabled = true;
    const view = viewOf(game.messages.get(target.dataset.card));
    for ( const entry of view?.entries ?? [] ) {
      if ( entry.status !== "rolled" ) await forceGroupRoll(view.id, entry.uuid);
    }
  }

  static #dismiss(event, target) {
    dismissed.add(target.dataset.card);
    refresh();
  }
};

/** Ouvre (ou ramène devant) la fenêtre de suivi, MJ seulement. */
export function openTracker() {
  if ( !game.user.isGM ) return null;
  const open = foundry.applications.instances.get(WINDOW_ID);
  if ( open ) {
    open.render({ force: true });
    open.bringToFront?.();
    return open;
  }
  const app = new (TrackerApp())();
  app.render({ force: true });
  return app;
}

/** Rafraîchit la fenêtre ouverte ; plus rien en cours : elle se ferme. */
function refresh() {
  const app = foundry.applications.instances.get(WINDOW_ID);
  if ( !app ) return;
  if ( !trackedViews().length ) return app.close();
  app.render();
}

export function registerGroupRollTracker() {
  // Le MJ qui fait une demande voit s'ouvrir le suivi ; toute carte qui change le rafraîchit.
  route("createChatMessage", message => {
    if ( !requestOf(message) || !game.user.isGM ) return;
    if ( message.author?.isSelf ) openTracker();
    else refresh();
  }, { always: true, label: "group roll: tracker not opened" });
  route("updateChatMessage", message => {
    if ( game.user.isGM && (requestOf(message) || message.getFlag(MODULE_ID, "groupRollResult")) ) refresh();
  },
    { always: true, label: "group roll: tracker not refreshed" });
  route("deleteChatMessage", message => { if ( requestOf(message) && game.user.isGM ) refresh(); },
    { always: true, label: "group roll: tracker not refreshed" });
}

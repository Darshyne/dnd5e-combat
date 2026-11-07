/**
 * §397 : la fenêtre « Lancer un combat » (MJ) et son bouton dans la barre d'outils des tokens (masquable : réglage `combatLaunchButton`).
 * La macro « Lancer un combat » du compendium « Outils du MJ » et `api.combatLaunch.open()` l'ouvrent aussi. Ouvrir met le jeu en pause
 * (runtime/combat-launch.mjs `beginLaunch`) ; fermer sans lancer la lève.
 */

import { MODULE_ID } from "../constants.mjs";
import { launchCandidates, beginLaunch, cancelLaunch, launchCombat, LAUNCH_BUTTON, LAUNCH_PLAYLIST } from "../runtime/combat-launch.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const windowId = "das-combat-launch";
let LaunchClass = null;

const LaunchApp = () => LaunchClass ??= class CombatLaunchApp extends foundry.applications.api.ApplicationV2 {
  constructor(options={}) {
    super({ ...options, id: windowId });
    this.launched = false;
    this.lists = launchCandidates();
    this.chosen = new Map();
    for ( const list of Object.values(this.lists) ) for ( const e of list ) this.chosen.set(e.uuid, { on: e.checked, surprised: false });
    let playlist = "";
    try { playlist = game.settings.get(MODULE_ID, LAUNCH_PLAYLIST) ?? ""; } catch {}
    this.values = { npcAuto: true, grouped: false, playlist: game.playlists.has(playlist) ? playlist : "" };
  }

  static DEFAULT_OPTIONS = {
    classes: ["das-screen", "das-group-roll", "das-combat-launch"],
    window: { icon: "fa-solid fa-swords", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      launch: CombatLaunchApp.#launch,
      pick: CombatLaunchApp.#pick,
      toggle: CombatLaunchApp.#toggle,
      surprise: CombatLaunchApp.#surprise
    }
  };

  get title() {
    return loc("Lancement.Titre");
  }

  /** Une liste : une grille de vignettes — clic sur le portrait = participe ou non, « ! » = surpris (choix de l'utilisateur, 2026-11-07). */
  #section(key, list) {
    const tiles = list.map(e => {
      const c = this.chosen.get(e.uuid) ?? { on: false, surprised: false };
      const notes = [];
      if ( e.summon === "after" ) notes.push(["fa-link", loc("Lancement.ApresMaitre")]);
      else if ( e.summon === "own" ) notes.push(["fa-paw", loc("Lancement.Invocation")]);
      if ( e.hiddenToken ) notes.push(["fa-eye-slash", loc("Lancement.Cache")]);
      const tip = [e.name, ...notes.map(n => n[1])].join(" — ");
      return `<div class="das-launch__tile${c.on ? " on" : ""}${c.surprised ? " surprised" : ""}">
        <button type="button" class="das-launch__portrait" data-action="toggle" data-uuid="${esc(e.uuid)}" data-tooltip="${esc(tip)}"
          aria-pressed="${c.on}"><img src="${esc(e.img)}" alt="${esc(e.name)}"></button>
        <button type="button" class="das-launch__surprise" data-action="surprise" data-uuid="${esc(e.uuid)}" ${c.on ? "" : "disabled"}
          data-tooltip="${esc(loc("Lancement.Surpris"))}" aria-pressed="${c.surprised}">!</button>
        ${notes.length ? `<span class="das-launch__badges">${notes.map(n => `<i class="fa-solid ${n[0]}"></i>`).join("")}</span>` : ""}
        <span class="das-launch__name">${esc(e.name)}</span>
      </div>`;
    }).join("");
    return `<fieldset class="das-launch__list">
      <legend>${esc(loc(`Lancement.Liste.${key}`))}
        <button type="button" class="das-link" data-action="pick" data-list="${key}" data-pick="all">${esc(loc("JetGroupe.Tous"))}</button>
        <button type="button" class="das-link" data-action="pick" data-list="${key}" data-pick="none">${esc(loc("JetGroupe.Aucun"))}</button>
      </legend>
      ${tiles ? `<div class="das-launch__grid">${tiles}</div>` : `<p class="das-muted">${esc(loc("Lancement.Vide"))}</p>`}
    </fieldset>`;
  }

  async _renderHTML() {
    const v = this.values;
    const count = [...this.chosen.values()].filter(c => c.on).length;
    const playlists = [`<option value="">${esc(loc("Lancement.SansMusique"))}</option>`,
      ...game.playlists.contents.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
        .map(p => `<option value="${p.id}" ${v.playlist === p.id ? "selected" : ""}>${esc(p.name)}</option>`)].join("");
    return `<form class="das-group-roll__body" autocomplete="off">
      <p class="das-muted">${esc(loc("Lancement.Aide"))}</p>
      <p class="das-launch__legend"><span><i class="fa-solid fa-hand-pointer"></i> ${esc(loc("Lancement.LegendeClic"))}</span>
        <span><b>!</b> ${esc(loc("Lancement.LegendeSurpris"))}</span></p>
      ${this.#section("players", this.lists.players)}
      ${this.#section("seen", this.lists.seen)}
      ${this.#section("rest", this.lists.rest)}
      <label class="check"><input type="checkbox" name="npcAuto" ${v.npcAuto ? "checked" : ""}> ${esc(loc("Lancement.PnjAuto"))}</label>
      <label class="check"><input type="checkbox" name="grouped" ${v.grouped ? "checked" : ""}> ${esc(loc("Lancement.Groupes"))}</label>
      <div class="das-group-roll__row"><label class="wide">${esc(loc("Lancement.Musique"))}<select name="playlist">${playlists}</select></label></div>
      <footer class="das-group-roll__foot">
        <button type="button" class="das-button" data-action="launch" ${count ? "" : "disabled"}>
          <i class="fa-solid fa-swords"></i>${esc(loc("Lancement.Lancer", { count }))}</button>
      </footer>
    </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const form = content.querySelector("form");
    form.addEventListener("submit", event => event.preventDefault());
    form.addEventListener("change", () => this.#read(form));
  }

  #read(form) {
    const f = form.elements;
    Object.assign(this.values, { npcAuto: f.npcAuto.checked, grouped: f.grouped.checked, playlist: f.playlist.value });
  }

  static #pick(event, target) {
    const on = target.dataset.pick === "all";
    for ( const e of this.lists[target.dataset.list] ?? [] ) {
      const c = this.chosen.get(e.uuid) ?? { on: false, surprised: false };
      this.chosen.set(e.uuid, { on, surprised: on && c.surprised });
    }
    this.#read(this.element.querySelector("form"));
    this.render();
  }

  static #toggle(event, target) {
    const c = this.chosen.get(target.dataset.uuid) ?? { on: false, surprised: false };
    this.chosen.set(target.dataset.uuid, { on: !c.on, surprised: !c.on && c.surprised });
    this.#read(this.element.querySelector("form"));
    this.render();
  }

  static #surprise(event, target) {
    const c = this.chosen.get(target.dataset.uuid);
    if ( !c?.on ) return;
    c.surprised = !c.surprised;
    this.#read(this.element.querySelector("form"));
    this.render();
  }

  static async #launch() {
    this.#read(this.element.querySelector("form"));
    const participants = [...this.chosen.entries()].filter(([, c]) => c.on).map(([uuid, c]) => ({ uuid, surprised: c.surprised }));
    if ( !participants.length ) return;
    try { await game.settings.set(MODULE_ID, LAUNCH_PLAYLIST, this.values.playlist ?? ""); } catch {}
    this.launched = true;
    await this.close();
    await launchCombat({ participants, ...this.values });
  }

  async _onClose(options) {
    await super._onClose?.(options);
    if ( !this.launched ) await cancelLaunch();
  }
};

/** Ouvre la fenêtre (MJ) : la pause d'abord. */
export async function openCombatLaunch() {
  if ( !game.user.isGM ) return null;
  const open = foundry.applications.instances.get(windowId);
  if ( open ) return open.bringToFront?.() ?? open;
  if ( !(await beginLaunch()) ) return null;
  return new (LaunchApp())().render({ force: true });
}

export function registerCombatLaunchUI() {
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    let shown = true;
    try { shown = game.settings.get(MODULE_ID, LAUNCH_BUTTON) !== false; } catch {}
    if ( !tokens?.tools || !game.user.isGM || !shown ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-combat-launch"] = {
      name: "das-combat-launch", order: last + 1, icon: "fa-solid fa-swords", title: "DND5ECOMBAT.Lancement.Bouton",
      button: true, visible: true,
      onChange: () => { openCombatLaunch().catch(err => console.error(`${MODULE_ID} | combat launch`, err)); }
    };
  }, { always: true, label: "combat launch: tool" });
}

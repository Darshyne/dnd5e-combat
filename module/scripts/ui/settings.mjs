/**
 * La fenêtre de réglages « DAS · Core » (2026-10-18, maquette validée par l'utilisateur : prive/maquettes/reglages-core.html).
 * Un seul bouton dans les réglages du module l'ouvre ; elle range par onglets (core/settings-layout.mjs) les réglages que chaque
 * fonctionnalité déclare toujours elle-même — clés, portée et valeurs inchangées. Au `setup`, ces réglages quittent la liste de Foundry
 * (`config` passe à faux) : on ne les règle plus qu'ici.
 *
 * Chaque onglet sépare « Pour toute la table » (portée monde, le MJ seul) et « Pour ce poste » (portée client, chacun) ; un joueur
 * n'y voit que ses réglages. Aides repliées derrière un « ? », dépliées pour ce que la recherche trouve. Rien ne s'écrit avant
 * « Enregistrer » ; un réglage qui demande de recharger (niveau d'automatisation) recharge tout le monde après confirmation.
 */
import { MODULE_ID } from "../constants.mjs";
import { placeSettings, matchesQuery } from "../core/settings-layout.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { openWelcome } from "./welcome.mjs";
import { openDiagnostic } from "./diagnostic.mjs";
import { openFactions } from "./factions.mjs";
import { reportsApi } from "./automation.mjs";

const WINDOW_ID = "das-settings";

/** Les fenêtres que les boutons d'outils ouvrent. */
const TOOLS = Object.freeze({
  welcome: () => openWelcome(),
  diagnostic: () => openDiagnostic(),
  reports: () => reportsApi.open(),
  factions: () => openFactions()
});

/** Les réglages du module que la fenêtre range (ceux qui étaient visibles dans la liste de Foundry), dans l'ordre de déclaration. */
const shown = new Set();

const settingOf = key => game.settings.settings.get(`${MODULE_ID}.${key}`);
const canEditWorld = () => game.user.isGM || game.user.can("SETTINGS_MODIFY");

/** La classe de la fenêtre, créée au premier usage (le module se charge aussi hors de Foundry : tests/load.test.mjs). */
let SettingsClass = null;
export const SettingsApp = () => SettingsClass ??= class SettingsApp extends foundry.applications.api.ApplicationV2 {
  /** Un seul exemplaire (comme l'accueil, B6) : le bouton des réglages crée la fenêtre par `new`. */
  constructor(options={}) {
    const existing = foundry.applications.instances.get(WINDOW_ID);
    if ( existing instanceof SettingsApp ) return existing;
    super(options);
  }

  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-screen", "das-settings"],
    window: { title: "DND5ECOMBAT.Reglages.Titre", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 960, height: 720 }
  };

  #tab = null;
  #query = "";
  #opened = new Set();     // aides dépliées à la main
  #pending = new Map();    // clé → valeur pas encore enregistrée

  /** Les onglets que ce spectateur voit : au moins un réglage pour lui, ou un outil (MJ). */
  #tabs() {
    const visible = key => (settingOf(key)?.scope !== "world") || canEditWorld();
    return placeSettings([...shown]).map(t => ({ ...t, keys: t.keys.filter(visible), tools: game.user.isGM ? t.tools : [] }))
      .filter(t => t.keys.length || t.tools.length);
  }

  #value(key) {
    return this.#pending.has(key) ? this.#pending.get(key) : game.settings.get(MODULE_ID, key);
  }

  async _renderHTML() {
    const tabs = this.#tabs();
    if ( !tabs.some(t => t.id === this.#tab) ) this.#tab = tabs[0]?.id ?? null;
    const searching = !!this.#query.trim();
    const root = document.createElement("div");
    root.className = "das-settings__body";
    const nav = tabs.map(t => `<button type="button" class="das-settings__tab${(t.id === this.#tab) && !searching ? " on" : ""}" data-tab="${t.id}">
      <i class="${t.icon}"></i><span>${esc(loc(`Reglages.Onglet.${t.id}`))}</span><span class="count">${t.keys.length}</span></button>`).join("");
    let content;
    if ( searching ) {
      const groups = tabs.map(t => ({ t, keys: t.keys.filter(k => this.#matches(k)) })).filter(g => g.keys.length);
      content = groups.length
        ? groups.map(g => `<h3 class="das-settings__group"><i class="${g.t.icon}"></i> ${esc(loc(`Reglages.Onglet.${g.t.id}`))}</h3>
            ${g.keys.map(k => this.#row(k, true)).join("")}`).join("")
        : `<p class="das-settings__empty">${esc(loc("Reglages.Aucun", { query: this.#query.trim() }))}</p>`;
    }
    else {
      const tab = tabs.find(t => t.id === this.#tab);
      content = tab ? this.#section(tab.keys, "world") + this.#section(tab.keys, "client") + this.#tools(tab.tools) : "";
    }
    root.innerHTML = `
      <div class="das-settings__bar">
        <label class="das-settings__search"><i class="fa-solid fa-magnifying-glass"></i>
          <input type="search" name="query" value="${esc(this.#query)}" placeholder="${esc(loc("Reglages.Recherche"))}"></label>
        <span class="das-settings__legend"><span class="world">${esc(loc("Reglages.Legende.world"))}</span><span class="client">${esc(loc("Reglages.Legende.client"))}</span></span>
      </div>
      <div class="das-settings__main"><nav>${nav}</nav><div class="das-settings__content">${content}</div></div>
      <footer class="das-settings__footer">
        <button type="button" class="das-button ghost" data-action="defaults" ${searching ? "disabled" : ""}><i class="fa-solid fa-rotate-left"></i> ${esc(loc("Reglages.Defauts"))}</button>
        <span class="spacer"></span>
        <button type="button" class="das-button ghost" data-action="cancel">${esc(loc("Reglages.Annuler"))}</button>
        <button type="button" class="das-button" data-action="save"><i class="fa-solid fa-floppy-disk"></i> ${esc(loc("Reglages.Enregistrer"))}</button>
      </footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  #matches(key) {
    const s = settingOf(key);
    return matchesQuery(this.#query, game.i18n.localize(s.name ?? ""), game.i18n.localize(s.hint ?? ""));
  }

  #section(keys, scope) {
    const rows = keys.filter(k => (settingOf(k)?.scope ?? "client") === scope);
    if ( !rows.length ) return "";
    return `<h3 class="das-settings__section ${scope}">${esc(loc(`Reglages.Section.${scope}`))}<span>${esc(loc(`Reglages.Qui.${scope}`))}</span></h3>
      ${rows.map(k => this.#row(k, false)).join("")}`;
  }

  #row(key, searching) {
    const s = settingOf(key);
    const value = this.#value(key);
    const changed = !foundry.utils.objectsEqual({ v: value }, { v: s.default });
    const open = searching || this.#opened.has(key);
    const hint = game.i18n.localize(s.hint ?? "");
    return `<div class="das-settings__row ${s.scope}" data-key="${key}">
      <div><div class="name">${esc(game.i18n.localize(s.name ?? key))}
        ${hint ? `<button type="button" class="das-settings__help${open ? " on" : ""}" data-help="${key}" aria-label="${esc(loc("Reglages.Aide"))}">?</button>` : ""}
        ${s.requiresReload ? `<span class="das-settings__badge reload">${esc(loc("Reglages.Recharge"))}</span>` : ""}
        ${changed ? `<span class="das-settings__badge changed">${esc(loc("Reglages.Modifie"))}</span>` : ""}</div>
        ${(open && hint) ? `<p class="hint">${esc(hint)}</p>` : ""}</div>
      <div class="ctl">${this.#control(key, s, value)}</div></div>`;
  }

  #control(key, s, value) {
    const type = s.type?.name ?? s.type;
    if ( type === "Boolean" ) return `<input type="checkbox" data-key="${key}" ${value ? "checked" : ""}>`;
    if ( s.choices ) {
      const options = Object.entries(s.choices).map(([v, label]) =>
        `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(game.i18n.localize(label))}</option>`).join("");
      return `<select data-key="${key}">${options}</select>`;
    }
    if ( (type === "Number") && s.range ) {
      const { min, max, step } = s.range;
      return `<span class="range"><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
        <input type="number" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></span>`;
    }
    if ( type === "Number" ) return `<input type="number" data-key="${key}" value="${value}">`;
    return `<input type="text" data-key="${key}" value="${esc(value)}">`;
  }

  #tools(tools) {
    if ( !tools.length ) return "";
    return `<h3 class="das-settings__section world">${esc(loc("Reglages.Outils"))}<span>${esc(loc("Reglages.Qui.world"))}</span></h3>
      ${tools.map(t => `<div class="das-settings__tool"><div><div class="name"><i class="${t.icon}"></i> ${esc(loc(`Reglages.Outil.${t.id}.Nom`))}</div>
        <p class="hint">${esc(loc(`Reglages.Outil.${t.id}.Aide`))}</p></div>
        <button type="button" class="das-button ghost" data-tool="${t.id}">${esc(loc(`Reglages.Outil.${t.id}.Bouton`))}</button></div>`).join("")}`;
  }

  _onRender() {
    const el = this.element;
    el.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { this.#tab = b.dataset.tab; this.#query = ""; this.render(); }));
    el.querySelectorAll("[data-help]").forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.help;
      if ( this.#opened.has(k) ) this.#opened.delete(k);
      else this.#opened.add(k);
      this.render();
    }));
    el.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => TOOLS[b.dataset.tool]?.()));
    const search = el.querySelector("input[name=query]");
    search?.addEventListener("input", () => {
      this.#query = search.value;
      this.render().then(() => {
        const again = this.element.querySelector("input[name=query]");
        again?.focus();
        again?.setSelectionRange(again.value.length, again.value.length);
      });
    });
    for ( const input of el.querySelectorAll("[data-key]") ) {
      // Le curseur d'un nombre suit en direct son champ ; le redessin (badge « modifié ») attend la fin du geste.
      if ( input.type === "range" ) input.addEventListener("input", () => {
        el.querySelector(`input[type=number][data-key="${input.dataset.key}"]`).value = input.value;
      });
      input.addEventListener("change", () => { this.#take(input); this.render(); });
    }
    el.querySelector("[data-action=defaults]")?.addEventListener("click", () => this.#defaults());
    el.querySelector("[data-action=cancel]")?.addEventListener("click", () => this.close());
    el.querySelector("[data-action=save]")?.addEventListener("click", () => this.#save());
  }

  #take(input) {
    const key = input.dataset.key;
    const s = settingOf(key);
    const type = s.type?.name ?? s.type;
    let value = (type === "Boolean") ? input.checked : (type === "Number") ? Number(input.value) : input.value;
    if ( (type === "Number") && !Number.isFinite(value) ) value = s.default;
    if ( (type === "Number") && s.range ) value = Math.min(s.range.max, Math.max(s.range.min, value));
    this.#pending.set(key, value);
  }

  #defaults() {
    const tab = this.#tabs().find(t => t.id === this.#tab);
    for ( const key of tab?.keys ?? [] ) this.#pending.set(key, settingOf(key).default);
    this.render();
    ui.notifications.info(loc("Reglages.DefautsRemis"));
  }

  async #save() {
    let reload = false;
    for ( const [key, value] of this.#pending ) {
      const s = settingOf(key);
      if ( (s.scope === "world") && !canEditWorld() ) continue;
      if ( foundry.utils.objectsEqual({ v: value }, { v: game.settings.get(MODULE_ID, key) }) ) continue;
      await game.settings.set(MODULE_ID, key, value);
      if ( s.requiresReload ) reload = true;
    }
    this.#pending.clear();
    await this.close();
    ui.notifications.info(loc("Reglages.Enregistre"));
    if ( !reload ) return;
    // Comme l'accueil (niveau d'automatisation) : le MJ confirme, puis tout le monde recharge.
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("Reglages.Titre") }, content: `<p>${esc(loc("Reglages.RechargerQuestion"))}</p>`, rejectClose: false
    });
    if ( !yes ) return;
    if ( game.user.isGM ) game.socket.emit("reload");
    foundry.utils.debouncedReload();
  }
};

export const openSettings = () => new (SettingsApp())().render({ force: true });

/**
 * Le bouton des réglages du module, ouvert à tous (chacun y règle son poste) ; au `setup`, une fois toutes les fonctionnalités
 * déclarées, leurs réglages visibles quittent la liste de Foundry pour la fenêtre.
 */
export function registerSettingsWindow() {
  if ( game.settings.registerMenu ) game.settings.registerMenu(MODULE_ID, "settingsWindow", {
    name: "DND5ECOMBAT.Reglages.Menu.Nom", label: "DND5ECOMBAT.Reglages.Menu.Bouton", hint: "DND5ECOMBAT.Reglages.Menu.Aide",
    icon: "fa-solid fa-sliders", type: SettingsApp(), restricted: false
  });
  route("setup", () => {
    for ( const s of game.settings.settings.values() ) {
      if ( (s.namespace !== MODULE_ID) || !s.config ) continue;
      shown.add(s.key);
      s.config = false;
    }
  }, { label: "settings window: settings taken from Foundry's list" });
}

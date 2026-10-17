/**
 * Les fenêtres de réglages de la suite DAS (2026-10-18, maquette validée par l'utilisateur : prive/maquettes/reglages-core.html).
 * Celle du moteur, et celle que chaque module voisin déclare par `api.settings.registerWindow` (Combat UI d'abord) : même fenêtre,
 * même aspect, un seul code. Un bouton « Ouvrir les réglages » dans les réglages du module l'ouvre ; elle range par onglets
 * (core/settings-layout.mjs) les réglages que le module déclare toujours lui-même — clés, portée et valeurs inchangées. Au `setup`
 * (et encore au `ready`, pour ce qui se déclare tard), ces réglages quittent la liste de Foundry (`config` passe à faux).
 *
 * Chaque onglet sépare « Pour toute la table » (portée monde, le MJ seul) et « Pour ce poste » (portée client, chacun) ; un joueur
 * n'y voit que ses réglages. Aides repliées derrière un « ? », dépliées pour ce que la recherche trouve. Rien ne s'écrit avant
 * « Enregistrer » ; un réglage qui demande de recharger recharge tout le monde après confirmation. Le moteur ne connaît aucun voisin :
 * il reçoit leur plan, leurs libellés (clés de traduction) et leurs outils.
 */
import { MODULE_ID } from "../constants.mjs";
import { SETTINGS_TABS, placeSettings, matchesQuery, validateWindow } from "../core/settings-layout.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { openWelcome } from "./welcome.mjs";
import { openDiagnostic } from "./diagnostic.mjs";
import { openFactions } from "./factions.mjs";
import { reportsApi } from "./automation.mjs";

/** Les fenêtres déclarées, par module : { namespace, windowId, title, tabs, shown, App }. */
const windows = new Map();
/** Le `setup` est passé : une fenêtre déclarée ensuite adopte ses réglages aussitôt. */
let setupDone = false;

const canEditWorld = () => game.user.isGM || game.user.can("SETTINGS_MODIFY");
const tr = key => (key ? game.i18n.localize(key) : "");

/**
 * Les réglages visibles d'un module quittent la liste de Foundry pour sa fenêtre. Sans effet tant que le module n'a rien déclaré ;
 * rejoué au `ready` pour un réglage déclaré après le `setup`.
 */
function adopt(win) {
  for ( const s of game.settings.settings.values() ) {
    if ( (s.namespace !== win.namespace) || !s.config ) continue;
    win.shown.add(s.key);
    s.config = false;
  }
}

/** La classe de fenêtre d'un module : créée au premier usage (le module se charge aussi hors de Foundry : tests/load.test.mjs). */
function appClass(win) {
  return win.App ??= class DasSettingsApp extends foundry.applications.api.ApplicationV2 {
    /** Un seul exemplaire par module (comme l'accueil, B6) : le bouton des réglages crée la fenêtre par `new`. */
    constructor(options={}) {
      const existing = foundry.applications.instances.get(win.windowId);
      if ( existing instanceof DasSettingsApp ) return existing;
      super(options);
    }

    static DEFAULT_OPTIONS = {
      id: win.windowId,
      classes: ["das-screen", "das-settings"],
      window: { title: win.title, icon: "fa-solid fa-sliders", resizable: true },
      position: { width: 960, height: 720 }
    };

    #tab = null;
    #query = "";
    #opened = new Set();     // aides dépliées à la main
    #pending = new Map();    // clé → valeur pas encore enregistrée

    #setting(key) {
      return game.settings.settings.get(`${win.namespace}.${key}`);
    }

    /** Les onglets que ce spectateur voit : au moins un réglage pour lui, ou un outil (MJ). */
    #tabs() {
      const visible = key => (this.#setting(key)?.scope !== "world") || canEditWorld();
      // Un outil est réservé au MJ, sauf s'il se déclare ouvert à tous (`everyone` : l'éditeur de couleurs de Combat UI).
      return placeSettings([...win.shown], win.tabs).map(t => ({ ...t, keys: t.keys.filter(visible),
        tools: t.tools.filter(tool => game.user.isGM || tool.everyone) }))
        .filter(t => t.keys.length || t.tools.length);
    }

    #value(key) {
      return this.#pending.has(key) ? this.#pending.get(key) : game.settings.get(win.namespace, key);
    }

    async _renderHTML() {
      const tabs = this.#tabs();
      if ( !tabs.some(t => t.id === this.#tab) ) this.#tab = tabs[0]?.id ?? null;
      const searching = !!this.#query.trim();
      const root = document.createElement("div");
      root.className = "das-settings__body";
      const nav = tabs.map(t => `<button type="button" class="das-settings__tab${(t.id === this.#tab) && !searching ? " on" : ""}" data-tab="${t.id}">
        <i class="${t.icon}"></i><span>${esc(tr(t.label))}</span><span class="count">${t.keys.length}</span></button>`).join("");
      let content;
      if ( searching ) {
        const groups = tabs.map(t => ({ t, keys: t.keys.filter(k => this.#matches(k)) })).filter(g => g.keys.length);
        content = groups.length
          ? groups.map(g => `<h3 class="das-settings__group"><i class="${g.t.icon}"></i> ${esc(tr(g.t.label))}</h3>
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
      const s = this.#setting(key);
      return matchesQuery(this.#query, tr(s.name), tr(s.hint));
    }

    #section(keys, scope) {
      const rows = keys.filter(k => (this.#setting(k)?.scope ?? "client") === scope);
      if ( !rows.length ) return "";
      return `<h3 class="das-settings__section ${scope}">${esc(loc(`Reglages.Section.${scope}`))}<span>${esc(loc(`Reglages.Qui.${scope}`))}</span></h3>
        ${rows.map(k => this.#row(k, false)).join("")}`;
    }

    #row(key, searching) {
      const s = this.#setting(key);
      const value = this.#value(key);
      const changed = !foundry.utils.objectsEqual({ v: value }, { v: s.default });
      const open = searching || this.#opened.has(key);
      const hint = tr(s.hint);
      return `<div class="das-settings__row ${s.scope}" data-key="${key}">
        <div><div class="name">${esc(tr(s.name) || key)}
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
          `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(tr(label))}</option>`).join("");
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
      const gmOnly = tools.every(t => !t.everyone);
      return `<h3 class="das-settings__section ${gmOnly ? "world" : "client"}">${esc(loc("Reglages.Outils"))}${gmOnly ? `<span>${esc(loc("Reglages.Qui.world"))}</span>` : ""}</h3>
        ${tools.map(t => `<div class="das-settings__tool"><div><div class="name"><i class="${t.icon ?? "fa-solid fa-toolbox"}"></i> ${esc(tr(t.name))}</div>
          <p class="hint">${esc(tr(t.hint))}</p></div>
          <button type="button" class="das-button ghost" data-tool="${t.id}">${esc(tr(t.button))}</button></div>`).join("")}`;
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
      const tools = new Map(win.tabs.flatMap(t => t.tools ?? []).map(t => [t.id, t]));
      el.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => tools.get(b.dataset.tool)?.open?.()));
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
      const s = this.#setting(key);
      const type = s.type?.name ?? s.type;
      let value = (type === "Boolean") ? input.checked : (type === "Number") ? Number(input.value) : input.value;
      if ( (type === "Number") && !Number.isFinite(value) ) value = s.default;
      if ( (type === "Number") && s.range ) value = Math.min(s.range.max, Math.max(s.range.min, value));
      this.#pending.set(key, value);
    }

    #defaults() {
      const tab = this.#tabs().find(t => t.id === this.#tab);
      for ( const key of tab?.keys ?? [] ) this.#pending.set(key, this.#setting(key).default);
      this.render();
      ui.notifications.info(loc("Reglages.DefautsRemis"));
    }

    async #save() {
      let reload = false;
      for ( const [key, value] of this.#pending ) {
        const s = this.#setting(key);
        if ( (s.scope === "world") && !canEditWorld() ) continue;
        if ( foundry.utils.objectsEqual({ v: value }, { v: game.settings.get(win.namespace, key) }) ) continue;
        await game.settings.set(win.namespace, key, value);
        if ( s.requiresReload ) reload = true;
      }
      this.#pending.clear();
      await this.close();
      ui.notifications.info(loc("Reglages.Enregistre"));
      if ( !reload ) return;
      // Comme l'accueil (niveau d'automatisation) : on confirme, puis tout le monde recharge (le MJ) ou ce poste seul.
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: tr(win.title) }, content: `<p>${esc(loc("Reglages.RechargerQuestion"))}</p>`, rejectClose: false
      });
      if ( !yes ) return;
      if ( game.user.isGM ) game.socket.emit("reload");
      foundry.utils.debouncedReload();
    }
  };
}

/** Déclare la fenêtre d'un module et son bouton dans les réglages de Foundry. */
function declare(win, menu={}) {
  windows.set(win.namespace, win);
  if ( game.settings.registerMenu ) game.settings.registerMenu(win.namespace, "settingsWindow", {
    name: menu.name ?? "DND5ECOMBAT.Reglages.Menu.NomVoisin", label: menu.label ?? "DND5ECOMBAT.Reglages.Menu.Bouton",
    hint: menu.hint ?? "DND5ECOMBAT.Reglages.Menu.AideVoisin", icon: menu.icon ?? "fa-solid fa-sliders", type: appClass(win), restricted: false
  });
  // Déclarée après le `setup` (un module voisin qui s'inscrit tard) : ses réglages quittent la liste tout de suite.
  if ( setupDone ) adopt(win);
  return { open: () => new (appClass(win))().render({ force: true }) };
}

/**
 * `api.settings.registerWindow(def)` : un module voisin range ses réglages dans la même fenêtre que le moteur. À appeler à son `init`
 * (ou son `setup`), après avoir déclaré ses réglages. `def` : `{ namespace, title, tabs: [{ id, icon, label, keys, tools: [{ id, icon,
 * name, hint, button, open, everyone? }] }], menu?: { name, label, hint, icon } }` — un outil est réservé au MJ sauf `everyone: true` — `title`, `label`, `name`, `hint`, `button` sont des clés de
 * traduction du module. Rend `{ open }`. Une déclaration invalide est refusée (erreur) : le module garde alors la liste de Foundry.
 */
export function registerWindow(def) {
  const problems = validateWindow(def);
  if ( problems.length ) throw new Error(`${MODULE_ID} | settings window of ${def?.namespace ?? "?"}: ${problems.join("; ")}`);
  if ( windows.has(def.namespace) ) return { open: () => new (appClass(windows.get(def.namespace)))().render({ force: true }) };
  return declare({ namespace: def.namespace, windowId: `das-settings-${def.namespace}`, title: def.title ?? "DND5ECOMBAT.Reglages.Titre",
    tabs: def.tabs, shown: new Set() }, def.menu ?? {});
}

/** La fenêtre du moteur. */
const ENGINE_TOOLS = Object.freeze({
  welcome: () => openWelcome(),
  diagnostic: () => openDiagnostic(),
  reports: () => reportsApi.open(),
  factions: () => openFactions()
});
let engine = null;

export const openSettings = () => engine?.open();

/**
 * Le bouton des réglages du moteur, ouvert à tous (chacun y règle son poste) ; au `setup`, une fois toutes les fonctionnalités
 * déclarées, leurs réglages visibles — et ceux des modules voisins inscrits — quittent la liste de Foundry pour leur fenêtre.
 */
export function registerSettingsWindow() {
  const tabs = SETTINGS_TABS.map(t => ({ ...t, label: `DND5ECOMBAT.Reglages.Onglet.${t.id}`,
    tools: (t.tools ?? []).map(tool => ({ ...tool, name: `DND5ECOMBAT.Reglages.Outil.${tool.id}.Nom`, hint: `DND5ECOMBAT.Reglages.Outil.${tool.id}.Aide`,
      button: `DND5ECOMBAT.Reglages.Outil.${tool.id}.Bouton`, open: ENGINE_TOOLS[tool.id] })) }));
  engine = declare({ namespace: MODULE_ID, windowId: "das-settings", title: "DND5ECOMBAT.Reglages.Titre", tabs, shown: new Set() }, {
    name: "DND5ECOMBAT.Reglages.Menu.Nom", hint: "DND5ECOMBAT.Reglages.Menu.Aide"
  });
  const adoptAll = () => { setupDone = true; for ( const win of windows.values() ) adopt(win); };
  route("setup", adoptAll, { label: "settings windows: settings taken from Foundry's list" });
  route("ready", adoptAll, { label: "settings windows: late settings taken from Foundry's list" });
}

/**
 * La fenêtre de réglages de la suite DAS (2026-10-18, maquette validée par l'utilisateur : prive/maquettes/reglages-core.html ;
 * §291, 2026-10-30 : **une seule fenêtre pour tous les modules DAS**, un onglet par module en haut). Chaque module y a son onglet :
 * le moteur, et chaque module actif dont le titre public commence par « DAS · » — le moteur ne nomme aucun voisin. Un module qui
 * déclare son plan (`api.settings.registerWindow` : Combat UI, Loot, Homebrew) garde ses sous-onglets à gauche ; les autres ont un
 * onglet simple, avec leurs réglages et, en outils, les boutons de menu qu'ils ont déclarés à Foundry. Les réglages gardent leur clé,
 * leur portée et leur valeur ; au `setup` (et encore au `ready`, pour ce qui se déclare tard), ils quittent la liste de Foundry.
 *
 * Chaque sous-onglet sépare « Pour toute la table » (portée monde, le MJ seul) et « Pour ce poste » (portée client, chacun) ; un
 * joueur n'y voit que ses réglages, et seulement les modules où il en a. Aides repliées derrière un « ? », dépliées pour ce que la
 * recherche trouve (dans tous les modules). Rien ne s'écrit avant « Enregistrer » ; un réglage qui demande de recharger recharge
 * tout le monde après confirmation. Un bouton « DAS » dans l'onglet Réglages de la barre latérale l'ouvre (réglage de poste
 * `sidebarButton`), comme le bouton « Ouvrir les réglages » de chaque module dans la liste de Foundry.
 */
import { MODULE_ID } from "../constants.mjs";
import { SETTINGS_TABS, placeSettings, matchesQuery, validateWindow, isSuiteTitle, shortTitle, orderModules } from "../core/settings-layout.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { openWelcome } from "./welcome.mjs";
import { openDiagnostic } from "./diagnostic.mjs";
import { openFactions } from "./factions.mjs";
import { reportsApi } from "./automation.mjs";

const WINDOW_ID = "das-settings";
const LOGO = `modules/${MODULE_ID}/assets/das-logo.png`;
export const SIDEBAR_SETTING = "sidebarButton";

/** Les modules de la fenêtre, par id : { namespace, tabs, shown, auto }. `auto` : onglet simple, plan déduit (module sans plan). */
const windows = new Map();
/** Le `setup` est passé : un module déclaré ensuite adopte ses réglages aussitôt. */
let setupDone = false;

const canEditWorld = () => game.user.isGM || game.user.can("SETTINGS_MODIFY");
const tr = key => (key ? game.i18n.localize(key) : "");
const settingOf = (ns, key) => game.settings.settings.get(`${ns}.${key}`);
const moduleTitle = ns => shortTitle(game.modules.get(ns)?.title ?? ns);

/**
 * Les réglages visibles d'un module quittent la liste de Foundry pour la fenêtre. Sans effet tant que le module n'a rien déclaré ;
 * rejoué au `ready` pour un réglage déclaré après le `setup`.
 */
function adopt(win) {
  for ( const s of game.settings.settings.values() ) {
    if ( (s.namespace !== win.namespace) || !s.config ) continue;
    win.shown.add(s.key);
    s.config = false;
  }
}

/** Les boutons de menu qu'un module sans plan a déclarés à Foundry : des outils de son onglet (MJ seulement s'ils sont restreints). */
function menuTools(ns) {
  return [...game.settings.menus.values()].filter(m => (m.namespace === ns) && (m.key !== `${ns}.settingsWindow`))
    .map(m => ({ id: m.key, icon: m.icon ?? "fa-solid fa-toolbox", name: m.name, hint: m.hint, button: m.label ?? m.name,
      everyone: !m.restricted, open: () => new m.type().render(true) }));
}

/** Les modules « DAS · » actifs qui n'ont pas déclaré de plan : un onglet simple chacun (§291). */
function discover() {
  for ( const mod of game.modules ) {
    if ( !mod.active || (mod.id === MODULE_ID) || windows.has(mod.id) || !isSuiteTitle(mod.title) ) continue;
    declare({ namespace: mod.id, auto: true, shown: new Set(),
      tabs: [{ id: "general", icon: "fa-solid fa-sliders", label: "DND5ECOMBAT.Reglages.Onglet.module", keys: [] }] });
  }
  for ( const win of windows.values() ) if ( win.auto ) win.tabs[0].tools = menuTools(win.namespace);
}

let AppClass = null;
/** La fenêtre : créée au premier usage (le module se charge aussi hors de Foundry : tests/load.test.mjs). Un seul exemplaire. */
const appClass = () => AppClass ??= class DasSettingsApp extends foundry.applications.api.ApplicationV2 {
  constructor(options={}) {
    const existing = foundry.applications.instances.get(WINDOW_ID);
    if ( existing instanceof DasSettingsApp ) return existing;
    super(options);
  }

  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-screen", "das-settings"],
    window: { title: "DND5ECOMBAT.Reglages.Titre", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 980, height: 740 }
  };

  #module = MODULE_ID;
  #tab = new Map();        // module → sous-onglet ouvert
  #query = "";
  #opened = new Set();     // aides dépliées à la main (« module.clé »)
  #pending = new Map();    // « module.clé » → valeur pas encore enregistrée

  /** Ouvre la fenêtre sur l'onglet d'un module (le bouton « Ouvrir les réglages » de ce module). */
  showModule(ns) {
    if ( windows.has(ns) ) this.#module = ns;
    this.#query = "";
    return this;
  }

  /** Les sous-onglets d'un module que ce spectateur voit : au moins un réglage pour lui, ou un outil. */
  #tabs(ns) {
    const win = windows.get(ns);
    if ( !win ) return [];
    const visible = key => (settingOf(ns, key)?.scope !== "world") || canEditWorld();
    // Un outil est réservé au MJ, sauf s'il se déclare ouvert à tous (`everyone` : l'éditeur de couleurs de Combat UI).
    return placeSettings([...win.shown], win.tabs).map(t => ({ ...t, keys: t.keys.filter(visible),
      tools: t.tools.filter(tool => game.user.isGM || tool.everyone) }))
      .filter(t => t.keys.length || t.tools.length);
  }

  /** Les modules que ce spectateur voit (au moins un sous-onglet), le moteur d'abord. */
  #modules() {
    return orderModules([...windows.values()].map(w => ({ id: w.namespace, title: moduleTitle(w.namespace), end: !!w.tab?.end,
      kind: w.tab?.kind ?? "settings", icon: w.tab?.icon ?? null })), MODULE_ID)
      .filter(m => this.#tabs(m.id).length);
  }

  #value(ns, key) {
    const k = `${ns}.${key}`;
    return this.#pending.has(k) ? this.#pending.get(k) : game.settings.get(ns, key);
  }

  async _renderHTML() {
    const modules = this.#modules();
    if ( !modules.some(m => m.id === this.#module) ) this.#module = modules[0]?.id ?? MODULE_ID;
    const ns = this.#module;
    const tabs = this.#tabs(ns);
    if ( !tabs.some(t => t.id === this.#tab.get(ns)) ) this.#tab.set(ns, tabs[0]?.id ?? null);
    const searching = !!this.#query.trim();
    const root = document.createElement("div");
    root.className = "das-settings__body";
    // Un atelier (`kind: "workshop"`) se distingue : à droite, son icône, un contour de la couleur d'accent.
    const top = modules.map((m, i) => `<button type="button" class="das-settings__module${(m.id === ns) && !searching ? " on" : ""}${m.kind === "workshop" ? " workshop" : ""}${(m.end && !modules[i - 1]?.end) ? " end" : ""}" data-module="${esc(m.id)}">
      ${(m.id === MODULE_ID) ? `<img src="${LOGO}" alt="">` : m.icon ? `<i class="${esc(m.icon)}"></i>` : ""}<span>${esc(m.title)}</span></button>`).join("");
    const nav = tabs.map(t => `<button type="button" class="das-settings__tab${(t.id === this.#tab.get(ns)) && !searching ? " on" : ""}" data-tab="${t.id}">
      <i class="${t.icon}"></i><span>${esc(tr(t.label))}</span><span class="count">${t.keys.length}</span></button>`).join("");
    let content;
    if ( searching ) {
      // La recherche parcourt tous les modules : un groupe par module › sous-onglet.
      const groups = modules.flatMap(m => this.#tabs(m.id).map(t => ({ m, t, keys: t.keys.filter(k => this.#matches(m.id, k)) })))
        .filter(g => g.keys.length);
      content = groups.length
        ? groups.map(g => `<h3 class="das-settings__group"><i class="${g.t.icon}"></i> ${esc(g.m.title)} › ${esc(tr(g.t.label))}</h3>
            ${g.keys.map(k => this.#row(g.m.id, k, true)).join("")}`).join("")
        : `<p class="das-settings__empty">${esc(loc("Reglages.Aucun", { query: this.#query.trim() }))}</p>`;
    }
    else {
      const tab = tabs.find(t => t.id === this.#tab.get(ns));
      const workshop = windows.get(ns)?.tab?.kind === "workshop";
      content = tab ? this.#section(ns, tab.keys, "world") + this.#section(ns, tab.keys, "client")
        + (workshop ? this.#workshop(ns, tab.tools) : this.#tools(tab.tools)) : "";
    }
    const single = (tabs.length < 2) || searching;
    root.innerHTML = `
      <nav class="das-settings__modules">${top}</nav>
      <div class="das-settings__bar">
        <label class="das-settings__search"><i class="fa-solid fa-magnifying-glass"></i>
          <input type="search" name="query" value="${esc(this.#query)}" placeholder="${esc(loc("Reglages.Recherche"))}"></label>
        <span class="das-settings__legend"><span class="world">${esc(loc("Reglages.Legende.world"))}</span><span class="client">${esc(loc("Reglages.Legende.client"))}</span></span>
      </div>
      <div class="das-settings__main${single ? " single" : ""}">${single ? "" : `<nav>${nav}</nav>`}<div class="das-settings__content">${content}</div></div>
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

  #matches(ns, key) {
    const s = settingOf(ns, key);
    return matchesQuery(this.#query, tr(s.name), tr(s.hint));
  }

  #section(ns, keys, scope) {
    const rows = keys.filter(k => (settingOf(ns, k)?.scope ?? "client") === scope);
    if ( !rows.length ) return "";
    return `<h3 class="das-settings__section ${scope}">${esc(loc(`Reglages.Section.${scope}`))}<span>${esc(loc(`Reglages.Qui.${scope}`))}</span></h3>
      ${rows.map(k => this.#row(ns, k, false)).join("")}`;
  }

  #row(ns, key, searching) {
    const s = settingOf(ns, key);
    const id = `${ns}.${key}`;
    const value = this.#value(ns, key);
    const changed = !foundry.utils.objectsEqual({ v: value }, { v: s.default });
    const open = searching || this.#opened.has(id);
    const hint = tr(s.hint);
    return `<div class="das-settings__row ${s.scope}" data-key="${esc(id)}">
      <div><div class="name">${esc(tr(s.name) || key)}
        ${hint ? `<button type="button" class="das-settings__help${open ? " on" : ""}" data-help="${esc(id)}" aria-label="${esc(loc("Reglages.Aide"))}">?</button>` : ""}
        ${s.requiresReload ? `<span class="das-settings__badge reload">${esc(loc("Reglages.Recharge"))}</span>` : ""}
        ${changed ? `<span class="das-settings__badge changed">${esc(loc("Reglages.Modifie"))}</span>` : ""}</div>
        ${(open && hint) ? `<p class="hint">${esc(hint)}</p>` : ""}</div>
      <div class="ctl">${this.#control(id, s, value)}</div></div>`;
  }

  #control(id, s, value) {
    const type = s.type?.name ?? s.type;
    const key = esc(id);
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

  /** Un atelier : ses outils en grandes cartes, sous une ligne qui dit ce qu'est le module (sa description). */
  #workshop(ns, tools) {
    if ( !tools.length ) return "";
    const about = game.modules.get(ns)?.description ?? "";
    return `${about ? `<p class="das-settings__about">${esc(about.replace(/<[^>]*>/g, ""))}</p>` : ""}
      <div class="das-settings__cards">${tools.map(t => `<button type="button" class="das-settings__card" data-tool="${esc(t.id)}">
        <i class="${t.icon ?? "fa-solid fa-toolbox"}"></i><strong>${esc(tr(t.name))}</strong>
        ${t.hint ? `<span>${esc(tr(t.hint))}</span>` : ""}<em>${esc(tr(t.button))}</em></button>`).join("")}</div>`;
  }

  #tools(tools) {
    if ( !tools.length ) return "";
    const gmOnly = tools.every(t => !t.everyone);
    return `<h3 class="das-settings__section ${gmOnly ? "world" : "client"}">${esc(loc("Reglages.Outils"))}${gmOnly ? `<span>${esc(loc("Reglages.Qui.world"))}</span>` : ""}</h3>
      ${tools.map(t => `<div class="das-settings__tool"><div><div class="name"><i class="${t.icon ?? "fa-solid fa-toolbox"}"></i> ${esc(tr(t.name))}</div>
        ${t.hint ? `<p class="hint">${esc(tr(t.hint))}</p>` : ""}</div>
        <button type="button" class="das-button ghost" data-tool="${esc(t.id)}">${esc(tr(t.button))}</button></div>`).join("")}`;
  }

  _onRender() {
    const el = this.element;
    el.querySelectorAll("[data-module]").forEach(b => b.addEventListener("click", () => { this.#module = b.dataset.module; this.#query = ""; this.render(); }));
    el.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
      this.#tab.set(this.#module, b.dataset.tab);
      this.#query = "";
      this.render();
    }));
    el.querySelectorAll("[data-help]").forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.help;
      if ( this.#opened.has(k) ) this.#opened.delete(k);
      else this.#opened.add(k);
      this.render();
    }));
    const tools = new Map([...windows.values()].flatMap(w => w.tabs.flatMap(t => t.tools ?? [])).map(t => [t.id, t]));
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
    // Les champs seulement : la ligne porte aussi `data-key`, et le `change` d'un champ remonte jusqu'à elle (une ligne n'a ni
    // `checked` ni `value` : une case revenait décochée, un curseur à sa valeur par défaut — vu par l'utilisateur le 2026-10-18).
    for ( const input of el.querySelectorAll(".ctl [data-key]") ) {
      // Le curseur d'un nombre suit en direct son champ ; le redessin (badge « modifié ») attend la fin du geste.
      if ( input.type === "range" ) input.addEventListener("input", () => {
        el.querySelector(`input[type=number][data-key="${CSS.escape(input.dataset.key)}"]`).value = input.value;
      });
      input.addEventListener("change", () => { this.#take(input); this.render(); });
    }
    el.querySelector("[data-action=defaults]")?.addEventListener("click", () => this.#defaults());
    el.querySelector("[data-action=cancel]")?.addEventListener("click", () => this.close());
    el.querySelector("[data-action=save]")?.addEventListener("click", () => this.#save());
  }

  /** « module.clé » → [module, clé] (un id de module n'a pas de point ; une clé peut en avoir). */
  #split(id) {
    const i = id.indexOf(".");
    return [id.slice(0, i), id.slice(i + 1)];
  }

  #take(input) {
    const id = input.dataset.key;
    const s = settingOf(...this.#split(id));
    const type = s.type?.name ?? s.type;
    let value = (type === "Boolean") ? input.checked : (type === "Number") ? Number(input.value) : input.value;
    if ( (type === "Number") && !Number.isFinite(value) ) value = s.default;
    if ( (type === "Number") && s.range ) value = Math.min(s.range.max, Math.max(s.range.min, value));
    this.#pending.set(id, value);
  }

  #defaults() {
    const ns = this.#module;
    const tab = this.#tabs(ns).find(t => t.id === this.#tab.get(ns));
    for ( const key of tab?.keys ?? [] ) this.#pending.set(`${ns}.${key}`, settingOf(ns, key).default);
    this.render();
    ui.notifications.info(loc("Reglages.DefautsRemis"));
  }

  async #save() {
    let reload = false;
    for ( const [id, value] of this.#pending ) {
      const [ns, key] = this.#split(id);
      const s = settingOf(ns, key);
      if ( !s || ((s.scope === "world") && !canEditWorld()) ) continue;
      if ( foundry.utils.objectsEqual({ v: value }, { v: game.settings.get(ns, key) }) ) continue;
      await game.settings.set(ns, key, value);
      if ( s.requiresReload ) reload = true;
    }
    this.#pending.clear();
    await this.close();
    ui.notifications.info(loc("Reglages.Enregistre"));
    if ( !reload ) return;
    // Comme l'accueil (niveau d'automatisation) : on confirme, puis tout le monde recharge (le MJ) ou ce poste seul.
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: tr("DND5ECOMBAT.Reglages.Titre") }, content: `<p>${esc(loc("Reglages.RechargerQuestion"))}</p>`, rejectClose: false
    });
    if ( !yes ) return;
    if ( game.user.isGM ) game.socket.emit("reload");
    foundry.utils.debouncedReload();
  }
};

/** La fenêtre, ouverte sur l'onglet d'un module (le moteur par défaut). */
export function openSettings(ns=MODULE_ID) {
  return new (appClass())().showModule(ns).render({ force: true });
}

/** Le bouton « Ouvrir les réglages » d'un module dans la liste de Foundry : la même fenêtre, sur son onglet. */
const launcherFor = ns => class extends appClass() {
  constructor(options={}) {
    super(options);
    this.showModule(ns);
  }
};

/** Inscrit un module dans la fenêtre, et son bouton dans les réglages de Foundry. */
function declare(win, menu={}) {
  windows.set(win.namespace, win);
  if ( game.settings.registerMenu ) game.settings.registerMenu(win.namespace, "settingsWindow", {
    name: menu.name ?? "DND5ECOMBAT.Reglages.Menu.NomVoisin", label: menu.label ?? "DND5ECOMBAT.Reglages.Menu.Bouton",
    hint: menu.hint ?? "DND5ECOMBAT.Reglages.Menu.AideVoisin", icon: menu.icon ?? "fa-solid fa-sliders", type: launcherFor(win.namespace), restricted: false
  });
  // Déclaré après le `setup` (un module voisin qui s'inscrit tard) : ses réglages quittent la liste tout de suite.
  if ( setupDone ) adopt(win);
  return { open: () => openSettings(win.namespace) };
}

/**
 * `api.settings.registerWindow(def)` : un module voisin range ses réglages en sous-onglets dans son onglet de la fenêtre DAS. À appeler
 * à son `init` (ou son `setup`), après avoir déclaré ses réglages. `def` : `{ namespace, title, tabs: [{ id, icon, label, keys, tools:
 * [{ id, icon, name, hint, button, open, everyone? }] }], menu?: { name, label, hint, icon } }` — un outil est réservé au MJ sauf
 * `everyone: true` ; `label`, `name`, `hint`, `button` sont des clés de traduction du module (`title` n'est plus lu : l'onglet porte le
 * titre du module). `tab?: { end, kind, icon }` : l'onglet du module en haut — `end` le range à droite après les autres, `kind:
 * "workshop"` en fait un atelier (des outils en grandes cartes, contour d'accent), `icon` (Font Awesome) précède son nom. Rend `{ open }`. Une déclaration invalide est refusée (erreur) : le module garde alors la liste de Foundry. Un
 * module « DAS · » qui ne déclare rien a quand même son onglet (§291).
 */
export function registerWindow(def) {
  const problems = validateWindow(def);
  if ( problems.length ) throw new Error(`${MODULE_ID} | settings window of ${def?.namespace ?? "?"}: ${problems.join("; ")}`);
  const known = windows.get(def.namespace);
  if ( known && !known.auto ) return { open: () => openSettings(def.namespace) };
  // Découvert d'abord (inscrit après le `setup`) : son plan remplace l'onglet simple, ses réglages déjà adoptés restent.
  return declare({ namespace: def.namespace, tabs: def.tabs, tab: def.tab ?? null, shown: known?.shown ?? new Set() }, def.menu ?? {});
}

/** Le moteur : ses outils. */
const ENGINE_TOOLS = Object.freeze({
  welcome: () => openWelcome(),
  diagnostic: () => openDiagnostic(),
  reports: () => reportsApi.open(),
  factions: () => openFactions()
});

/** §291 : le bouton « DAS » de l'onglet Réglages de la barre latérale, sous « Paramètres du jeu ». */
function sidebarButton(app, html) {
  const root = (html instanceof HTMLElement) ? html : html?.[0];
  if ( !root || root.querySelector(".das-sidebar-settings") ) return;
  let on = true;
  try { on = game.settings.get(MODULE_ID, SIDEBAR_SETTING); } catch { /* réglage pas encore déclaré */ }
  if ( !on ) return;
  const anchor = root.querySelector('button[data-app="configure"]');
  if ( !anchor ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "das-sidebar-settings";
  button.innerHTML = `<img src="${LOGO}" alt="" inert> ${esc(loc("Reglages.Barre"))}`;
  button.addEventListener("click", event => { event.preventDefault(); openSettings(); });
  anchor.after(button);
}

/**
 * La fenêtre est ouverte à tous (chacun y règle son poste) ; au `setup`, une fois toutes les fonctionnalités déclarées, les modules
 * « DAS · » sont découverts, et leurs réglages visibles quittent la liste de Foundry pour leur onglet.
 */
export function registerSettingsWindow() {
  game.settings.register(MODULE_ID, SIDEBAR_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SIDEBAR_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SIDEBAR_SETTING}.Aide`,
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => ui.settings?.render?.()
  });
  const tabs = SETTINGS_TABS.map(t => ({ ...t, label: `DND5ECOMBAT.Reglages.Onglet.${t.id}`,
    tools: (t.tools ?? []).map(tool => ({ ...tool, name: `DND5ECOMBAT.Reglages.Outil.${tool.id}.Nom`, hint: `DND5ECOMBAT.Reglages.Outil.${tool.id}.Aide`,
      button: `DND5ECOMBAT.Reglages.Outil.${tool.id}.Bouton`, open: ENGINE_TOOLS[tool.id] })) }));
  declare({ namespace: MODULE_ID, tabs, shown: new Set() }, { name: "DND5ECOMBAT.Reglages.Menu.Nom", hint: "DND5ECOMBAT.Reglages.Menu.Aide" });
  const adoptAll = () => {
    setupDone = true;
    discover();
    for ( const win of windows.values() ) adopt(win);
  };
  route("setup", adoptAll, { label: "settings window: settings taken from Foundry's list" });
  route("ready", adoptAll, { label: "settings window: late settings taken from Foundry's list" });
  route("renderSettings", sidebarButton, { always: true, label: "settings window: DAS button not added to the sidebar" });
}

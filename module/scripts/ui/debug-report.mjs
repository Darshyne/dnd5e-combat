/**
 * §380 (issue #36) : la fenêtre « Rapport de bug DAS » — les erreurs relevées sur ce client (et, chez le MJ actif, celles que les
 * joueurs lui ont envoyées), une description, l'environnement, la piste des derniers gestes ; un aperçu complet et modifiable ; trois
 * sorties, chacune sur un clic : copier le Markdown, enregistrer un fichier (.md ou .json), ouvrir la page « New issue » de GitHub
 * pré-remplie. Rien ne part sans ce clic. Ouverte depuis l'onglet Général de la fenêtre DAS (MJ et joueurs) ou le menu contextuel
 * d'un token (le MJ sur toute créature, un joueur sur les siennes : le contexte de ce token est joint ; réglage de monde `debugMenu`
 * pour retirer cette entrée) ; `api.debug.open()`.
 * Retour visuel : une pastille du nombre d'erreurs sur le bouton « Réglages DAS » de la barre latérale, et un avis à la première
 * erreur DAS de la session (réglage client `debugNotify`).
 */

import { MODULE_ID } from "../constants.mjs";
import { issueUrl, reportJson } from "../core/debug.mjs";
import { buildDebugReport, debugApi, reportRepos, roles } from "../runtime/debug.mjs";
import { reports as itemReports } from "../adapter/automation.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const WINDOW_ID = "das-debug-report";
export const DEBUG_NOTIFY_SETTING = "debugNotify";
export const DEBUG_MENU_SETTING = "debugMenu";
let notified = false;

/** Les titres du Markdown : en anglais (la langue des issues), quelle que soit la langue de l'interface. */
const LABELS = {};

let ReportClass = null;
const ReportApp = () => ReportClass ??= class DebugReport extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-screen", "das-debug-report"],
    window: { icon: "fa-solid fa-bug", resizable: true },
    position: { width: 640, height: 720 },
    actions: {
      copy: DebugReport.#copy, saveMd: DebugReport.#saveMd, saveJson: DebugReport.#saveJson, github: DebugReport.#github,
      refresh: DebugReport.#refresh, verbose: DebugReport.#verbose, clear: DebugReport.#clear, all: DebugReport.#all
    }
  };

  /** Ce que la personne a choisi : gardé entre deux rendus. */
  choices = { description: "", selected: null, includeNames: false, includeFlagged: false, includeLogs: false, repo: null };
  token = null;
  built = null;
  edited = false;

  constructor(options={}) {
    super(options);
    this.token = options.token ?? null;
  }

  get title() {
    return loc("Debogueur.Titre");
  }

  #build() {
    this.built = buildDebugReport({ ...this.choices, selected: this.choices.selected ?? undefined, token: this.token, labels: LABELS });
    this.edited = false;
    return this.built;
  }

  async _renderHTML() {
    const { report, markdown } = this.#build();
    const r = roles({ gm: loc("Debogueur.RoleMJ"), player: loc("Debogueur.RoleJoueur") });
    const who = id => (id ? (r.get(id) ?? "?") : "?");
    // Les erreurs de la suite d'abord ; celles des autres modules (gardées par « tous les modules ») après, décochées par défaut.
    const groups = debugApi.errors().sort((a, b) => Number(!!a.thirdParty) - Number(!!b.thirdParty));
    const selected = this.choices.selected ? new Set(this.choices.selected) : null;
    const badge = (on, key) => (on ? `<span class="das-debug__badge">${esc(loc(key))}</span>` : "");
    const list = groups.length ? `<ul class="das-debug__errors">${groups.map(g => `<li${g.thirdParty ? ` class="das-debug__other"` : ""}>
        <label><input type="checkbox" data-sig="${esc(g.sig)}" ${(selected ? selected.has(g.sig) : !g.thirdParty) ? "checked" : ""}>
        <span class="das-debug__count">×${g.count}</span>
        <span class="das-debug__module">${esc(g.module ?? "?")}</span>
        ${badge(g.thirdParty, "Debogueur.HorsSuite")}${badge(g.deprecation, "Debogueur.Depreciation")}
        <span class="das-debug__message" data-tooltip="${esc(g.stack.slice(0, 4).join("\n"))}">${esc(g.label ? `${g.label} — ` : "")}${esc(g.message)}</span>
        <small class="das-muted">${esc(g.clients.map(who).join(", "))}</small></label></li>`).join("")}</ul>`
      : `<p class="das-muted">${esc(loc("Debogueur.AucuneErreur"))}</p>`;
    const repos = reportRepos(report);
    const repo = this.choices.repo ?? repos[0]?.repo ?? "";
    const repoOptions = repos.map(x => `<option value="${esc(x.repo)}" ${x.repo === repo ? "selected" : ""}>${esc(x.repo)}</option>`).join("");
    const box = (key, on, text) => `<label class="das-debug__option"><input type="checkbox" data-option="${key}" ${on ? "checked" : ""}> ${esc(text)}</label>`;
    let flaggedCount = 0;
    try { flaggedCount = Object.keys(itemReports()).length; } catch { /* réglage illisible */ }
    const verbose = debugApi.verbose();
    return `
      <p class="das-debug__intro">${esc(loc("Debogueur.Intro"))}</p>
      ${this.token ? `<p class="das-muted"><i class="fa-solid fa-location-dot"></i> ${esc(loc("Debogueur.AvecToken"))}</p>` : ""}
      <section><h3>${esc(loc("Debogueur.Erreurs", { count: groups.length }))}
        ${groups.length > 1 ? `<button type="button" class="das-button ghost" data-action="all">${esc(loc("Debogueur.ToutCocher"))}</button>` : ""}</h3>
        ${list}</section>
      <section><h3>${esc(loc("Debogueur.Description"))}</h3>
        <textarea data-field="description" rows="3" placeholder="${esc(loc("Debogueur.DescriptionAide"))}">${esc(this.choices.description)}</textarea></section>
      <section class="das-debug__options">
        ${box("includeNames", this.choices.includeNames, loc("Debogueur.InclureNoms"))}
        ${flaggedCount ? box("includeFlagged", this.choices.includeFlagged, loc("Debogueur.InclureSignalements", { count: flaggedCount })) : ""}
        ${debugApi.logs().length ? box("includeLogs", this.choices.includeLogs, loc("Debogueur.InclureJournal", { count: debugApi.logs().length })) : ""}
      </section>
      <section><h3>${esc(loc("Debogueur.Apercu"))} <small class="das-muted">${esc(loc("Debogueur.ApercuAide"))}</small></h3>
        <textarea class="das-debug__preview" data-field="preview" spellcheck="false">${esc(markdown)}</textarea></section>
      <footer class="das-debug__actions">
        <button type="button" class="das-button" data-action="copy"><i class="fa-solid fa-copy"></i> ${esc(loc("Debogueur.Copier"))}</button>
        <button type="button" class="das-button ghost" data-action="saveMd"><i class="fa-solid fa-file-lines"></i> .md</button>
        <button type="button" class="das-button ghost" data-action="saveJson"><i class="fa-solid fa-file-code"></i> .json</button>
        ${repos.length ? `<span class="das-debug__github"><select data-field="repo">${repoOptions}</select>
          <button type="button" class="das-button ghost" data-action="github"><i class="fa-brands fa-github"></i> ${esc(loc("Debogueur.GitHub"))}</button></span>` : ""}
      </footer>
      <footer class="das-debug__tools">
        <button type="button" class="das-button ghost" data-action="refresh"><i class="fa-solid fa-rotate"></i> ${esc(loc("Debogueur.Actualiser"))}</button>
        <button type="button" class="das-button ghost${verbose ? " on" : ""}" data-action="verbose" data-tooltip="${esc(loc(game.user.isGM ? "Debogueur.DetailAideMJ" : "Debogueur.DetailAide"))}">
          <i class="fa-solid fa-magnifying-glass-plus"></i> ${esc(loc(verbose ? "Debogueur.DetailCouper" : "Debogueur.DetailActiver"))}</button>
        <button type="button" class="das-button ghost" data-action="clear"><i class="fa-solid fa-broom"></i> ${esc(loc("Debogueur.Effacer"))}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender() {
    const root = this.element;
    // Les choix se lisent sans tout redessiner : seul l'aperçu change (et la frappe dans l'aperçu n'est pas écrasée sans raison).
    root.querySelector('[data-field="description"]')?.addEventListener("input", event => {
      this.choices.description = event.target.value;
      this.#updatePreview();
    });
    root.querySelector('[data-field="preview"]')?.addEventListener("input", () => { this.edited = true; });
    root.querySelector('[data-field="repo"]')?.addEventListener("change", event => { this.choices.repo = event.target.value; });
    for ( const input of root.querySelectorAll("input[data-option]") ) {
      input.addEventListener("change", () => {
        this.choices[input.dataset.option] = input.checked;
        this.#updatePreview();
      });
    }
    for ( const input of root.querySelectorAll("input[data-sig]") ) {
      input.addEventListener("change", () => {
        this.choices.selected = Array.from(root.querySelectorAll("input[data-sig]:checked"), i => i.dataset.sig);
        this.#updatePreview();
      });
    }
  }

  #updatePreview() {
    const area = this.element?.querySelector('[data-field="preview"]');
    const { markdown } = this.#build();
    if ( area ) area.value = markdown;
  }

  /** Le texte qui part : l'aperçu tel que la personne l'a laissé. */
  #text() {
    return this.element?.querySelector('[data-field="preview"]')?.value ?? this.built?.markdown ?? "";
  }

  #fileName(ext) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `das-bug-report-${stamp}.${ext}`;
  }

  static async #copy() {
    await game.clipboard.copyPlainText(this.#text());
    ui.notifications.info(loc("Debogueur.Copie"));
  }

  static #saveMd() {
    foundry.utils.saveDataToFile(this.#text(), "text/markdown", this.#fileName("md"));
    ui.notifications.info(loc("Debogueur.Enregistre"));
  }

  static #saveJson() {
    if ( this.edited ) ui.notifications.warn(loc("Debogueur.JsonSansRetouche"));
    foundry.utils.saveDataToFile(reportJson(this.built.report), "application/json", this.#fileName("json"));
    ui.notifications.info(loc("Debogueur.Enregistre"));
  }

  static #github() {
    const repo = this.element?.querySelector('[data-field="repo"]')?.value;
    const first = this.built.report.errors[0];
    const title = this.choices.description.trim().split("\n")[0].slice(0, 80)
      || (first ? `[${first.module ?? "?"}] ${first.message}`.slice(0, 80) : "Bug report");
    const url = issueUrl({ repo, title, body: this.#text(), note: loc("Debogueur.NoteTronque") });
    if ( !url ) return;
    window.open(url, "_blank", "noopener");
    ui.notifications.info(loc("Debogueur.GitHubOuvert"));
  }

  static #refresh() {
    this.render();
  }

  static async #verbose() {
    const on = !debugApi.verbose();
    if ( game.user.isGM ) {
      const n = await debugApi.verboseEverywhere(on);
      ui.notifications.info(loc(on ? "Debogueur.DetailPartout" : "Debogueur.DetailPartoutCoupe", { count: n }));
    } else {
      debugApi.verbose(on);
    }
    this.render();
  }

  static #clear() {
    debugApi.clear();
    this.choices.selected = null;
    updateBadge();
    this.render();
  }

  static #all() {
    this.choices.selected = null;
    this.render();
  }
};

/** Ouvre la fenêtre (ou la ramène devant). `token` : le contexte joint, depuis le menu contextuel. */
export function openDebugReport({ token=null }={}) {
  const open = foundry.applications.instances.get(WINDOW_ID);
  if ( open ) {
    if ( token ) open.token = token;
    open.render({ force: true });
    open.bringToFront?.();
    return open;
  }
  const app = new (ReportApp())({ token });
  app.render({ force: true });
  return app;
}

/** L'entrée du menu contextuel : le MJ sur toute créature, un joueur sur les siennes ; absente si le MJ l'a retirée (`debugMenu`). */
export function debugMenuEntry(target) {
  const doc = target?.document ?? target;
  if ( !doc?.actor || !(game.user.isGM || doc.isOwner) ) return null;
  let shown = true;
  try { shown = game.settings.get(MODULE_ID, DEBUG_MENU_SETTING); } catch { /* réglage pas encore déclaré */ }
  if ( !shown ) return null;
  return { icon: "fa-solid fa-bug", label: loc("Debogueur.Menu"), run: () => openDebugReport({ token: doc }) };
}

/* -------------------------------------------- */
/*  Retour visuel                               */
/* -------------------------------------------- */

/** La pastille du bouton « Réglages DAS » : le nombre d'erreurs relevées (répétitions comprises), cachée à zéro. */
export function updateBadge() {
  const button = document.querySelector(".das-sidebar-settings");
  if ( !button ) return;
  const total = debugApi.total();
  let badge = button.querySelector(".das-debug-badge");
  if ( !total ) { badge?.remove(); return; }
  if ( !badge ) {
    badge = document.createElement("span");
    badge.className = "das-debug-badge";
    button.append(badge);
  }
  badge.textContent = total > 99 ? "99+" : String(total);
  badge.dataset.tooltip = loc("Debogueur.Pastille", { count: total });
}

function onError(group, isNew) {
  updateBadge();   // la fenêtre ouverte n'est pas redessinée : l'aperçu retouché serait perdu (« Actualiser » le fait)
  if ( !isNew || notified || !globalThis.ui?.notifications ) return;
  let on = true;
  try { on = game.settings.get(MODULE_ID, DEBUG_NOTIFY_SETTING); } catch { /* réglage pas encore déclaré */ }
  if ( !on ) return;
  notified = true;
  ui.notifications.warn(loc("Debogueur.Avis"));
}

export function registerDebugReport() {
  game.settings.register(MODULE_ID, DEBUG_NOTIFY_SETTING, {
    name: "DND5ECOMBAT.Reglage.debugNotify.Nom", hint: "DND5ECOMBAT.Reglage.debugNotify.Aide",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, DEBUG_MENU_SETTING, {
    name: "DND5ECOMBAT.Reglage.debugMenu.Nom", hint: "DND5ECOMBAT.Reglage.debugMenu.Aide",
    scope: "world", config: true, type: Boolean, default: true
  });
  debugApi.onError((group, isNew) => {
    // Une erreur levée avant `ready` attend : ni avis ni fenêtre tant que l'interface n'est pas là.
    if ( game.ready ) onError(group, isNew);
  });
  route("ready", () => {
    updateBadge();
    if ( debugApi.total() ) onError(null, true);
  }, { always: true, label: "debug report: errors raised during loading not shown" });
  route("renderSettings", () => updateBadge(), { always: true, label: "debug report: sidebar badge not updated" });
}

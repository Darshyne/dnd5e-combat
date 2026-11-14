/**
 * §439 : le message de mise à jour. Ouvert chez le MJ actif à la première ouverture d'un monde après un changement de version du
 * moteur (réglage de monde `welcomeSeen` : la dernière version vue, ui/welcome.mjs), et ensuite depuis l'accueil ou les réglages.
 * Quatre parties : les nouveautés des versions sorties depuis la dernière vue, les modules de la suite à mettre à jour, les écarts
 * de Foundry, de dnd5e et des livres avec les versions testées (et les risques écrits pour ces versions), les vérifications du
 * Diagnostic du monde conseillées. Les notes sont des données (content/releases.mjs), les règles sont pures
 * (core/release-notes.mjs) ; ici, seulement la lecture du monde et l'affichage. Aspect : celui de l'accueil (`das-screen`).
 */
import { MODULE_ID } from "../constants.mjs";
import { RELEASES } from "../content/releases.mjs";
import { compareVersions, hasNews, releaseReport } from "../core/release-notes.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { LOGO } from "../runtime/diagnostic/backup.mjs";
import { openDiagnostic } from "./diagnostic.mjs";

export const SEEN_SETTING = "welcomeSeen";
const RELEASES_URL = "https://github.com/Darshyne/dnd5e-combat/releases";
const LEVEL_ICON = Object.freeze({ info: "fa-solid fa-circle-info", warn: "fa-solid fa-triangle-exclamation" });

const currentVersion = () => game.modules.get(MODULE_ID)?.version ?? "";

/** Ce monde : Foundry, le système, les modules avec leur version. */
function installed() {
  return {
    foundry: game.version,
    system: game.system.version,
    modules: Array.from(game.modules).map(m => ({ id: m.id, title: m.title, version: m.version, active: !!m.active }))
  };
}

/** Le MJ a vu cette version : l'accueil et le message de mise à jour ne s'ouvrent plus seuls. */
export async function markSeen() {
  const version = currentVersion() || "1";
  if ( game.user.isGM && (game.settings.get(MODULE_ID, SEEN_SETTING) !== version) ) await game.settings.set(MODULE_ID, SEEN_SETTING, version);
}

/** La classe de la fenêtre, créée au premier usage (le module se charge aussi hors de Foundry : tests/load.test.mjs). */
let ReleaseNotesClass = null;
export const ReleaseNotesApp = () => ReleaseNotesClass ??= class ReleaseNotesApp extends foundry.applications.api.ApplicationV2 {
  constructor(options={}) {
    super(options);
    this.since = options.since ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: "das-release-notes",
    classes: ["das-screen", "das-welcome", "das-news"],
    window: { title: "DND5ECOMBAT.Nouveautes.Titre", icon: "fa-solid fa-bullhorn", resizable: true },
    position: { width: 760, height: "auto" }
  };

  async _renderHTML() {
    const report = releaseReport(RELEASES, { seen: this.since, current: currentVersion(), installed: installed() });
    const root = document.createElement("div");
    root.className = "das-welcome__body das-news__body";
    root.innerHTML = [hero(report), news(report), modules(report), compat(report), diagnostic(report), footer()].join("");
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender() {
    const el = this.element;
    for ( const button of el.querySelectorAll("[data-check]") ) {
      button.addEventListener("click", () => openDiagnostic({ check: button.dataset.check || null }));
    }
    el.querySelector("[data-action=close]")?.addEventListener("click", () => this.close());
  }

  async _onClose(options) {
    await markSeen();
    return super._onClose?.(options);
  }
};

function hero(report) {
  const from = report.seen && (report.seen !== report.current);
  return `<header class="das-hero">
    <img src="${LOGO}" alt="DAS" class="das-hero__logo">
    <div>
      <h1>${esc(loc("Nouveautes.Titre"))}</h1>
      <p class="das-muted">${esc(from ? loc("Nouveautes.DeVers", { from: report.seen, to: report.current }) : loc("Accueil.Version", { version: report.current }))}</p>
    </div>
  </header>`;
}

function news(report) {
  const blocks = report.notes.map(n => `<article class="das-news__version">
      <h3>${esc(n.version)}</h3>
      <ul>${n.highlights.map(id => `<li>${esc(loc(`Nouveautes.Point.${id}`))}</li>`).join("")}</ul>
    </article>`).join("");
  return `<h2><i class="fa-solid fa-star"></i> ${esc(loc("Nouveautes.NouveautesTitre"))}</h2>
    ${blocks || `<p class="das-muted">${esc(loc("Nouveautes.SansNote"))}</p>`}`;
}

function modules(report) {
  const title = `<h2><i class="fa-solid fa-cubes"></i> ${esc(loc("Nouveautes.ModulesTitre"))}</h2>`;
  if ( !report.late.length ) return `${title}<p class="das-news__ok"><i class="fa-solid fa-circle-check"></i> ${esc(loc("Nouveautes.ModulesOk"))}</p>`;
  return `${title}
    <p>${esc(loc("Nouveautes.ModulesTexte", { version: report.current }))}</p>
    <ul class="das-news__list">${report.late.map(m => `<li class="warn"><i class="${LEVEL_ICON.warn}"></i>
      <span>${esc(loc("Nouveautes.ModuleRetard", { title: m.title, version: m.version, tested: m.tested }))}</span></li>`).join("")}</ul>
    <p class="das-muted">${esc(loc("Nouveautes.ModulesAide"))}</p>`;
}

function compat(report) {
  const t = report.tested;
  const title = `<h2><i class="fa-solid fa-plug-circle-check"></i> ${esc(loc("Nouveautes.CompatTitre"))}</h2>`;
  const tested = t ? `<p class="das-muted">${esc(loc("Nouveautes.Teste", { version: report.current, foundry: t.foundry, system: t.system }))}</p>` : "";
  const gaps = report.compatibility.map(g => `<li class="${g.level}"><i class="${LEVEL_ICON[g.level]}"></i>
      <span>${esc(loc(`Nouveautes.Ecart.${g.way}`, { title: g.title, version: g.version, tested: g.tested }))}</span></li>`).join("");
  const risks = report.risks.map(r => `<li class="warn"><i class="${LEVEL_ICON.warn}"></i>
      <span><strong>${esc(loc(`Nouveautes.Risque.${r.id}.Titre`))}</strong> ${esc(loc(`Nouveautes.Risque.${r.id}.Texte`))}</span></li>`).join("");
  const body = (gaps || risks) ? `<ul class="das-news__list">${gaps}${risks}</ul>`
    : `<p class="das-news__ok"><i class="fa-solid fa-circle-check"></i> ${esc(loc("Nouveautes.CompatOk"))}</p>`;
  return `${title}${tested}${body}`;
}

function diagnostic(report) {
  const checks = report.checks.map(c => `<li><button type="button" class="das-link" data-check="${esc(c.id)}">
      <i class="fa-solid fa-magnifying-glass"></i> ${esc(loc(`Diagnostic.Verif.${c.id}.Nom`))}</button></li>`).join("");
  return `<section class="das-diag">
    <div>
      <h2><i class="fa-solid fa-stethoscope"></i> ${esc(loc("Diagnostic.Titre"))}</h2>
      <p>${esc(loc(checks ? "Nouveautes.DiagnosticConseille" : "Nouveautes.DiagnosticTexte"))}</p>
      ${checks ? `<ul class="das-news__checks">${checks}</ul>` : ""}
    </div>
    <button type="button" class="das-button" data-check=""><i class="fa-solid fa-magnifying-glass"></i> ${esc(loc("Accueil.DiagnosticBouton"))}</button>
  </section>`;
}

function footer() {
  return `<footer class="das-links">
    <a href="${RELEASES_URL}" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i> ${esc(loc("Nouveautes.ToutesLesVersions"))}</a>
    <span class="das-muted">${esc(loc("Nouveautes.Retrouver"))}</span>
    <button type="button" class="das-button ghost" data-action="close">${esc(loc("Nouveautes.Fermer"))}</button>
  </footer>`;
}

/**
 * Pour l'API, l'accueil et les réglages : ouvrir le message de mise à jour. `since` : la dernière version vue (les notes des versions
 * sorties depuis) ; sans elle, les dernières notes.
 */
export async function openReleaseNotes({ since=null }={}) {
  const existing = foundry.applications.instances.get("das-release-notes");
  if ( existing && (existing.since !== since) ) await existing.close();
  return new (ReleaseNotesApp())({ since }).render({ force: true });
}

/**
 * Au `ready`, chez le MJ actif, quand le monde a déjà vu une version du moteur et que ce n'est plus celle-ci : le message s'ouvre s'il
 * a quelque chose à dire, et la version est notée vue à sa fermeture. Version plus ancienne que la vue (retour en arrière), ou rien à
 * dire : la version est notée, sans fenêtre. Rend vrai quand la fenêtre s'est ouverte.
 */
export async function announceUpdate() {
  const seen = game.settings.get(MODULE_ID, SEEN_SETTING);
  const current = currentVersion();
  if ( !seen || !current || (seen === current) ) return false;
  if ( compareVersions(current, seen) > 0 ) {
    const report = releaseReport(RELEASES, { seen, current, installed: installed() });
    if ( hasNews(report) ) { await openReleaseNotes({ since: seen }); return true; }
  }
  await markSeen();
  return false;
}

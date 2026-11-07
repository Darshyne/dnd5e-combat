/**
 * §388 : le test de connexion d'un joueur — l'entrée « Tester la connexion (DAS) » du menu clic droit de la liste des joueurs (MJ
 * seulement, joueur connecté, pas soi-même ; retirée avec l'entrée du rapport de bug, réglage de monde `debugMenu`), et sa fenêtre :
 * le diagnostic, du plus grave au moins grave, les mesures dépliables, « Copier » (Markdown, pour Discord ou une issue), « Refaire ».
 */

import { MODULE_ID } from "../constants.mjs";
import { connectionMarkdown, worstLevel } from "../core/connection.mjs";
import { testConnection } from "../runtime/connection.mjs";
import { roles } from "../runtime/debug.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { DEBUG_MENU_SETTING } from "./debug-report.mjs";

const ICON = {
  ok: "fa-solid fa-circle-check", info: "fa-solid fa-circle-info", warn: "fa-solid fa-triangle-exclamation", bad: "fa-solid fa-circle-xmark"
};
const t = (key, data) => loc(`Connexion.${key}`, data);

let TestClass = null;
const TestApp = () => TestClass ??= class ConnectionTest extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["das-connection-test"],
    window: { icon: "fa-solid fa-tower-broadcast", resizable: true },
    position: { width: 520, height: "auto" },
    actions: { copy: ConnectionTest.#copy, retry: ConnectionTest.#retry }
  };

  userId = null;
  result = null;
  step = null;
  running = false;

  constructor(options={}) {
    super({ ...options, id: `das-connection-test-${options.userId}` });
    this.userId = options.userId;
  }

  get title() {
    return t("Titre");
  }

  /** Le rôle du joueur à l'écran du MJ : son nom (la fenêtre ne quitte pas la table ; le texte copié, lui, dit « Player 1 »). */
  get who() {
    return game.users.get(this.userId)?.name ?? "?";
  }

  async run() {
    if ( this.running ) return;
    this.running = true;
    this.result = null;
    this.step = t("EnCours");
    this.render({ force: true });
    try {
      this.result = await testConnection(this.userId, {
        progress: (kind, i, n) => {
          this.step = (kind === "ping") ? t("Ping", { i, n }) : t("Sonde");
          const el = this.element?.querySelector(".das-connection__step");
          if ( el ) el.textContent = this.step;
        }
      });
    } catch(err) {
      this.result = { error: err?.message ?? String(err) };
    }
    this.running = false;
    this.render();
  }

  async _renderHTML() {
    const head = `<p class="das-connection__who"><i class="fa-solid fa-user"></i> ${esc(this.who)}</p>`;
    if ( this.running || !this.result ) {
      return `${head}<p class="das-connection__step"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(this.step ?? "")}</p>
        <p class="das-muted">${esc(t("Attente"))}</p>`;
    }
    if ( this.result.error ) {
      return `${head}<p class="das-connection__finding bad"><i class="${ICON.bad}"></i> ${esc(t("Erreur", { error: this.result.error }))}</p>
        <footer class="das-connection__actions"><button type="button" class="das-button" data-action="retry"><i class="fa-solid fa-rotate"></i> ${esc(t("Refaire"))}</button></footer>`;
    }
    const { findings, probe, pings } = this.result;
    const worst = worstLevel(findings);
    const list = findings.map(f => `<li class="das-connection__finding ${f.level}"><i class="${ICON[f.level]}"></i>
      <span>${esc(t(`Constat.${f.id}`, f.data))}</span>${this.#advice(f)}</li>`).join("");
    const rows = probe ? [
      ["Foundry", probe.foundry], [t("Champ.systeme"), probe.system], [t("Champ.langue"), probe.language],
      [t("Champ.navigateur"), probe.client], [t("Champ.os"), probe.os], [t("Champ.gpu"), probe.gpu],
      [t("Champ.texture"), probe.maxTextureSize], [t("Champ.performance"), probe.performanceMode], [t("Champ.fps"), probe.fps],
      [t("Champ.ecran"), probe.screen], [t("Champ.fenetre"), probe.viewport], [t("Champ.memoire"), probe.memory], [t("Champ.coeurs"), probe.cores],
      [t("Champ.ping"), pings?.median !== null ? `${pings.min} / ${pings.median} / ${pings.worst} ms` : "—"],
      [t("Champ.horloge"), Number.isFinite(pings?.offset) ? `${pings.offset} ms` : "—"],
      [t("Champ.modules"), (probe.modules ?? []).map(m => `${m.id} ${m.version ?? "?"}`).join(", ")]
    ].filter(([, v]) => (v !== null) && (v !== undefined) && (v !== "")) : [];
    return `${head}
      <p class="das-connection__summary ${worst}"><i class="${ICON[worst]}"></i> ${esc(t(`Resume.${worst}`))}</p>
      <ul class="das-connection__findings">${list}</ul>
      ${rows.length ? `<details class="das-connection__details"><summary>${esc(t("Details"))}</summary>
        <table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join("")}</table></details>` : ""}
      <footer class="das-connection__actions">
        <button type="button" class="das-button" data-action="copy"><i class="fa-solid fa-copy"></i> ${esc(t("Copier"))}</button>
        <button type="button" class="das-button ghost" data-action="retry"><i class="fa-solid fa-rotate"></i> ${esc(t("Refaire"))}</button>
      </footer>`;
  }

  /** Le conseil d'un constat, s'il en a un (clé `Connexion.Conseil.<id>`). */
  #advice(finding) {
    const key = `DND5ECOMBAT.Connexion.Conseil.${finding.id}`;
    if ( (finding.level === "ok") || !game.i18n.has(key) ) return "";
    return `<small class="das-muted">${esc(game.i18n.localize(key))}</small>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #copy() {
    if ( !this.result?.findings ) return;
    const role = roles({ gm: "GM", player: "Player" }).get(this.userId) ?? this.result.role;
    await game.clipboard.copyPlainText(connectionMarkdown({ ...this.result, role }, (key, data) => t(key, data)));
    ui.notifications.info(t("Copie"));
  }

  static #retry() {
    this.run();
  }
};

/** Ouvre la fenêtre du test pour un joueur et le lance (ou ramène devant celle déjà ouverte). */
export function openConnectionTest(userId) {
  const open = foundry.applications.instances.get(`das-connection-test-${userId}`);
  if ( open ) {
    open.bringToFront?.();
    if ( !open.running ) open.run();
    return open;
  }
  const app = new (TestApp())({ userId });
  app.run();
  return app;
}

function menuShown() {
  try { return game.settings.get(MODULE_ID, DEBUG_MENU_SETTING); } catch { return true; }
}

/** L'entrée du menu de la liste des joueurs. */
function onUserContext(app, options) {
  options.push({
    label: "DND5ECOMBAT.Connexion.Menu",
    icon: "fa-solid fa-tower-broadcast",
    visible: li => {
      const user = game.users.get(li?.dataset?.userId);
      return !!user && game.user.isGM && user.active && !user.isSelf && menuShown();
    },
    onClick: (event, li) => openConnectionTest(li.dataset.userId)
  });
}

export function registerConnectionTest() {
  route("getUserContextOptions", onUserContext, { always: true, label: "connection test: player list menu entry missing" });
}

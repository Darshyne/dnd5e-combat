/**
 * L'écran d'accueil de la suite (SPEC §177) : ouvert chez le MJ actif au premier lancement du moteur dans un monde (réglage
 * `welcomeSeen`), et ensuite par le bouton « Accueil et diagnostic » des réglages du module. Logo, mot de bienvenue, les trois
 * niveaux d'automatisation (§117) en grandes cartes, le diagnostic du monde, les liens. Aspect : celui du site (anthracite,
 * fuchsia, dégradé du logo).
 *
 * Changer de niveau recharge le monde (réglage `requiresReload`, runtime/levels.mjs) : le MJ le confirme, tous les clients
 * rechargent (`game.socket.emit("reload")`, puis ce client).
 */
import { MODULE_ID } from "../constants.mjs";
import { LEVELS } from "../core/levels.mjs";
import { LEVEL_SETTING } from "../runtime/levels.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { LOGO } from "../runtime/diagnostic/backup.mjs";
import { openDiagnostic } from "./diagnostic.mjs";

const SEEN_SETTING = "welcomeSeen";
const LINKS = Object.freeze({
  site: "https://darshyne.github.io", discord: "https://discord.gg/PDSq8dYdTP", github: "https://github.com/Darshyne/dnd5e-combat"
});
const ICONS = Object.freeze({ essentials: "fa-solid fa-person-walking", assisted: "fa-solid fa-dice-d20", full: "fa-solid fa-wand-sparkles" });

/** La classe de la fenêtre, créée au premier usage (le module se charge aussi hors de Foundry : tests/load.test.mjs). */
let WelcomeClass = null;
export const WelcomeApp = () => WelcomeClass ??= class WelcomeApp extends foundry.applications.api.ApplicationV2 {
  /** B6 : un seul exemplaire — le menu des réglages crée la fenêtre par `new` : il reçoit celle qui est déjà ouverte. */
  constructor(options={}) {
    const existing = foundry.applications.instances.get("das-welcome");
    if ( existing instanceof WelcomeApp ) return existing;
    super(options);
  }

  static DEFAULT_OPTIONS = {
    id: "das-welcome",
    classes: ["das-screen", "das-welcome"],
    window: { title: "DND5ECOMBAT.Accueil.Titre", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 860, height: "auto" }
  };

  /** Le niveau en vigueur, ou null si le moteur est en veille (réglage non déclaré). */
  #level() {
    try { return game.settings.get(MODULE_ID, LEVEL_SETTING); }
    catch { return null; }
  }

  async _renderHTML() {
    const api = game.modules.get(MODULE_ID).api;
    const level = this.#level();
    const standby = api?.reason ? loc(`Accueil.Veille.${api.reason}`) : null;
    const cards = LEVELS.map(l => {
      const current = (l === level);
      return `<article class="das-card${current ? " current" : ""}">
        <i class="das-card__icon ${ICONS[l]}"></i>
        <h3>${esc(loc(`Accueil.Niveau.${l}.Nom`))}</h3>
        <p>${esc(loc(`Accueil.Niveau.${l}.Texte`))}</p>
        <button type="button" class="das-button${current ? " ghost" : ""}" data-level="${l}" ${(current || standby) ? "disabled" : ""}>
          ${esc(loc(current ? "Accueil.NiveauActuel" : "Accueil.Choisir"))}</button>
      </article>`;
    }).join("");
    const version = game.modules.get(MODULE_ID)?.version ?? "";
    const root = document.createElement("div");
    root.className = "das-welcome__body";
    root.innerHTML = `
      <header class="das-hero">
        <img src="${LOGO}" alt="DAS" class="das-hero__logo">
        <div>
          <h1>${esc(loc("Accueil.Nom"))}</h1>
          <p class="das-muted">${esc(loc("Accueil.Version", { version }))}</p>
        </div>
      </header>
      <p class="das-lead">${esc(loc("Accueil.Bienvenue"))}</p>
      <h2>${esc(loc("Accueil.NiveauxTitre"))}</h2>
      ${standby ? `<p class="das-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(standby)}</p>` : ""}
      <div class="das-cards">${cards}</div>
      <p class="das-muted">${esc(loc("Accueil.NiveauxAide"))}</p>
      <section class="das-diag">
        <div>
          <h2><i class="fa-solid fa-stethoscope"></i> ${esc(loc("Diagnostic.Titre"))}</h2>
          <p>${esc(loc("Accueil.DiagnosticTexte"))}</p>
        </div>
        <button type="button" class="das-button" data-action="diagnostic"><i class="fa-solid fa-magnifying-glass"></i> ${esc(loc("Accueil.DiagnosticBouton"))}</button>
      </section>
      <footer class="das-links">
        <a href="${LINKS.site}" target="_blank" rel="noopener"><i class="fa-solid fa-globe"></i> ${esc(loc("Accueil.Site"))}</a>
        <a href="${LINKS.discord}" target="_blank" rel="noopener"><i class="fa-brands fa-discord"></i> Discord</a>
        <a href="${LINKS.github}" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i> GitHub</a>
        <button type="button" class="das-button ghost" data-action="close">${esc(loc("Accueil.Fermer"))}</button>
      </footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender() {
    const el = this.element;
    for ( const button of el.querySelectorAll("[data-level]") ) {
      button.addEventListener("click", () => this.#choose(button.dataset.level));
    }
    el.querySelector("[data-action=diagnostic]")?.addEventListener("click", () => openDiagnostic());
    el.querySelector("[data-action=close]")?.addEventListener("click", () => this.close());
  }

  /** Changer de niveau : le MJ confirme, puis tout le monde recharge. */
  async #choose(level) {
    if ( !LEVELS.includes(level) ) return;
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc(`Accueil.Niveau.${level}.Nom`) },
      content: `<p>${esc(loc("Accueil.ConfirmerNiveau", { level: loc(`Accueil.Niveau.${level}.Nom`) }))}</p>`,
      rejectClose: false
    });
    if ( !yes ) return;
    await markSeen();
    await game.settings.set(MODULE_ID, LEVEL_SETTING, level);
    game.socket.emit("reload");
    foundry.utils.debouncedReload();
  }

  async _onClose(options) {
    await markSeen();
    return super._onClose?.(options);
  }
};

async function markSeen() {
  const version = game.modules.get(MODULE_ID)?.version ?? "1";
  if ( game.user.isGM && (game.settings.get(MODULE_ID, SEEN_SETTING) !== version) ) await game.settings.set(MODULE_ID, SEEN_SETTING, version);
}

/** Pour l'API : ouvrir l'accueil. */
export const openWelcome = () => new (WelcomeApp())().render({ force: true });

/**
 * Déclaré même en veille (Midi-QOL actif : le diagnostic sert justement à nettoyer ses traces). Le réglage `welcomeSeen` garde la
 * version du moteur vue par le MJ ; vide = jamais vu : l'accueil s'ouvre au premier `ready` chez le MJ actif.
 */
export function registerWelcome({ menu=false }={}) {
  game.settings.register(MODULE_ID, SEEN_SETTING, { scope: "world", config: false, type: String, default: "" });
  // Moteur actif : l'accueil s'ouvre depuis la fenêtre de réglages (ui/settings.mjs). En veille, la fenêtre n'existe pas : le bouton
  // reste dans la liste de Foundry, pour que le diagnostic nettoie les traces de Midi-QOL.
  if ( menu && game.settings.registerMenu ) game.settings.registerMenu(MODULE_ID, "welcome", {
    name: "DND5ECOMBAT.Accueil.Menu.Nom", label: "DND5ECOMBAT.Accueil.Menu.Bouton", hint: "DND5ECOMBAT.Accueil.Menu.Aide",
    icon: "fa-solid fa-dragon", type: WelcomeApp(), restricted: true
  });
  route("ready", () => {
    if ( !game.users.activeGM?.isSelf ) return;
    if ( game.settings.get(MODULE_ID, SEEN_SETTING) ) return;
    openWelcome();
  }, { label: "welcome screen" });
}

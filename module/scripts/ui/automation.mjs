/**
 * Pastille d'automatisation et signalements, sur la fiche d'acteur de dnd5e 6 (SPEC §9.2). MJ seulement.
 *
 * Chaque ligne d'item (`[data-item-id] > .item-row .item-name`, templates/inventory/inventory.hbs:88-106 de dnd5e 6.0.3,
 * rendu commun à l'inventaire, aux sorts et aux capacités) reçoit :
 *   - une pastille : moteur / auto / passif / manuel (adapter/automation.mjs), l'infobulle dit pourquoi ; aucune
 *     sur du matériel sans rien à jouer (butin, focaliseur) ;
 *   - un drapeau : coché quand l'item a posé problème en partie, avec une note facultative.
 * Les signalements se relisent en fin de partie dans le panneau « Bilan de la partie » (réglages du module, ou
 * `api.reports.open()`), qui les copie, les envoie au chat du MJ ou les efface.
 *
 * Le hook est `renderBaseActorSheet` : ApplicationV2 appelle `render<Classe>` pour chaque classe de la chaîne
 * (client/applications/api/application.mjs:417-442, 591), donc PJ et PNJ par la classe commune de dnd5e.
 */

import { MODULE_ID } from "../constants.mjs";
import { reportsByActor, reportsText } from "../core/automation.mjs";
import { automationOfItem, reports, reportOf, setReport, clearReport, REPORTS_SETTING } from "../adapter/automation.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

const SETTING = "automationBadges";
const CSS = "dnd5e-combat-auto";
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const shown = () => game.user.isGM && game.settings.get(MODULE_ID, SETTING);

const ICONS = { rule: "fa-solid fa-gears", auto: "fa-solid fa-dice-d20", passive: "fa-solid fa-feather", manual: "fa-solid fa-hand" };

/** L'infobulle de la pastille : le niveau, puis ce que le moteur reconnaît et d'où. */
function badgeTooltip(auto) {
  const lines = [`<strong>${esc(loc(`Automatisation.${auto.level}.Nom`))}</strong>`, esc(loc(`Automatisation.${auto.level}.Aide`))];
  if ( auto.rules.length ) {
    const from = Object.entries(auto.layers ?? {}).filter(([, on]) => on).map(([k]) => loc(`Automatisation.Couche.${k}`));
    lines.push(`${esc(loc("LabelValue", { label: loc("Automatisation.Regles"), value: auto.rules.join(", ") }))}${from.length ? ` (${esc(from.join(", "))})` : ""}`);
  }
  if ( auto.identifier ) lines.push(`<code>${esc(auto.identifier)}</code>`);
  return lines.join("<br>");
}

function decorate(app, element) {
  element.querySelectorAll(`.${CSS}`).forEach(n => n.remove());
  if ( !shown() ) return;
  const actor = app.document;
  for ( const row of element.querySelectorAll("[data-item-id]") ) {
    const item = actor?.items?.get(row.dataset.itemId);
    const name = row.querySelector(":scope > .item-row .item-name");
    if ( !item || !name ) continue;
    const auto = automationOfItem(item);
    const report = reportOf(item);
    const box = document.createElement("span");
    box.className = CSS;
    const badge = (auto.level === "none") ? "" : `
      <span class="badge ${auto.level}" data-tooltip-html="${esc(badgeTooltip(auto))}" data-tooltip-direction="UP">
        <i class="${ICONS[auto.level]}"></i>${esc(loc(`Automatisation.${auto.level}.Court`))}</span>`;
    box.innerHTML = `${badge}
      <a class="flag${report ? " on" : ""}" role="button" aria-label="${esc(loc("Signalement.Titre"))}"
         data-tooltip-text="${esc(report ? (report.note || loc("Signalement.SansNote")) : loc("Signalement.Poser"))}">
        <i class="${report ? "fa-solid" : "fa-regular"} fa-flag"></i></a>`;
    // Ni la ligne (utiliser l'item), ni le glisser, ni les actions de la fiche : ce clic est le nôtre.
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    box.addEventListener("pointerdown", ev => ev.stopPropagation());
    box.addEventListener("dragstart", stop);
    box.querySelector(".badge")?.addEventListener("click", stop);
    box.querySelector(".flag").addEventListener("click", ev => { stop(ev); editReport(item); });
    const title = name.querySelector(":scope > .name");
    if ( title ) title.after(box);
    else name.append(box);
  }
}

/** Poser, modifier ou retirer le signalement d'un item. */
async function editReport(item) {
  const current = reportOf(item);
  const buttons = [{ action: "save", label: loc(current ? "Signalement.Enregistrer" : "Signalement.Poser"), icon: "fa-solid fa-flag",
    default: true, callback: (event, button) => ({ note: button.form.elements.note.value }) }];
  if ( current ) buttons.push({ action: "remove", label: loc("Signalement.Retirer"), icon: "fa-solid fa-xmark", callback: () => ({ remove: true }) });
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("LabelValue", { label: loc("Signalement.Titre"), value: item.name }), icon: "fa-solid fa-flag" },
    position: { width: 420 },
    content: `<p class="hint">${esc(loc("Signalement.Aide"))}</p>
      <textarea name="note" rows="3" placeholder="${esc(loc("Signalement.Exemple"))}">${esc(current?.note ?? "")}</textarea>`,
    buttons,
    rejectClose: false
  }).catch(() => null);
  if ( !answer ) return;
  if ( answer.remove ) await clearReport(item.uuid);
  else await setReport(item, answer.note);
}

/**
 * Le panneau de fin de partie : les signalements par acteur. La classe se crée au premier usage : `foundry.applications`
 * n'existe pas au chargement du module hors de Foundry (tests/load.test.mjs).
 */
let panelClass = null;
const Panel = () => (panelClass ??= makePanel());

function makePanel() {
return class ReportsPanel extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-reports`,
    classes: [`${MODULE_ID}-reports`],
    window: { title: "DND5ECOMBAT.Bilan.Titre", icon: "fa-solid fa-flag", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      copy: ReportsPanel.#copy,
      chat: ReportsPanel.#chat,
      remove: ReportsPanel.#remove,
      clear: ReportsPanel.#clear,
      open: ReportsPanel.#open
    }
  };

  async _renderHTML() {
    const groups = reportsByActor(reports());
    if ( !groups.length ) return `<p class="hint">${esc(loc("Bilan.Vide"))}</p>`;
    const when = at => new Date(at).toLocaleString(game.i18n.lang);
    const body = groups.map(({ actor, items }) => `
      <h3>${esc(actor)}</h3>
      <ul>${items.map(i => `
        <li>
          <a data-action="open" data-uuid="${esc(i.key)}"><strong>${esc(i.item)}</strong></a>
          ${i.note ? `<span class="note">${esc(i.note)}</span>` : ""}
          <span class="when">${esc(when(i.at))}</span>
          <a data-action="remove" data-uuid="${esc(i.key)}" data-tooltip="${esc(loc("Signalement.Retirer"))}"><i class="fa-solid fa-xmark"></i></a>
        </li>`).join("")}</ul>`).join("");
    return `<div class="list">${body}</div>
      <footer class="form-footer">
        <button type="button" data-action="copy"><i class="fa-solid fa-copy"></i>${esc(loc("Bilan.Copier"))}</button>
        <button type="button" data-action="chat"><i class="fa-solid fa-comment"></i>${esc(loc("Bilan.Chat"))}</button>
        <button type="button" data-action="clear"><i class="fa-solid fa-trash"></i>${esc(loc("Bilan.Effacer"))}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #copy() {
    await game.clipboard.copyPlainText(reportsText(reports()));
    ui.notifications.info(loc("Bilan.Copie"));
  }

  static async #chat() {
    const content = reportsByActor(reports()).map(({ actor, items }) => `<p><strong>${esc(actor)}</strong></p><ul>${
      items.map(i => `<li>${i.note ? esc(loc("LabelValue", { label: i.item, value: i.note })) : esc(i.item)}</li>`).join("")}</ul>`).join("");
    await ChatMessage.create({ content: `<h3>${esc(loc("Bilan.Titre"))}</h3>${content}`,
      whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id), speaker: { alias: loc("Bilan.Titre") } });
  }

  static async #remove(event, target) {
    await clearReport(target.dataset.uuid);
  }

  static async #clear() {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: loc("Bilan.Titre") },
      content: `<p>${esc(loc("Bilan.EffacerQuestion"))}</p>`, rejectClose: false }).catch(() => false);
    if ( ok ) await clearReport(null);
  }

  static async #open(event, target) {
    const item = await fromUuid(target.dataset.uuid);
    if ( item ) item.sheet?.render(true);
    else ui.notifications.warn(loc("Bilan.Introuvable"));
  }
};
}

/** Rafraîchit ce qui montre les signalements : fiches d'acteur ouvertes et panneau. */
function refresh() {
  for ( const app of foundry.applications.instances.values() ) {
    if ( (panelClass && (app instanceof panelClass)) || (app.document instanceof Actor) ) app.render();
  }
}

/** Exposé sur `api.reports` : le bilan, pour une macro ou pour Claude par le connecteur. */
export const reportsApi = Object.freeze({
  list: () => reports(),
  text: () => reportsText(reports()),
  open: () => new (Panel())().render(true),
  clear: uuid => clearReport(uuid ?? null)
});

export function registerAutomation() {
  game.settings.register(MODULE_ID, REPORTS_SETTING, { scope: "world", config: false, type: Object, default: {},
    onChange: () => refresh() });
  game.settings.register(MODULE_ID, SETTING, { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.automationBadges.Nom", hint: "DND5ECOMBAT.Reglage.automationBadges.Aide",
    onChange: () => refresh() });
  if ( game.settings.registerMenu ) game.settings.registerMenu(MODULE_ID, "reportsPanel", { name: "DND5ECOMBAT.Bilan.Titre",
    label: "DND5ECOMBAT.Bilan.Ouvrir", hint: "DND5ECOMBAT.Bilan.Aide", icon: "fa-solid fa-flag", type: Panel(), restricted: true });
  route("renderBaseActorSheet", (app, element) => decorate(app, element), { label: "automation badges", level: "warn" });
}

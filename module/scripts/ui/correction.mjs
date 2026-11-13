/**
 * §396 : la fenêtre de la correction du MJ (runtime/correction.mjs) et §395 / §396 : les deux entrées du clic droit d'un objet de la
 * fiche dnd5e (`dnd5e.getItemContextOptions`, inventory.mjs:636) — « Lancer sans DAS » (propriétaire) et « Correction du MJ » (MJ).
 * Une interface voisine (barre d'actions) ouvre la même fenêtre par `api.correction.open(itemOuActivité)` et lance sans DAS par
 * `api.vanilla.use(itemOuActivité, { event })`.
 */

import { applyCorrection, correctionShape, correctionTargets, undoCorrection, undoOf, DAMAGE_MODES, ATTACK_OUTCOMES, SAVE_OUTCOMES } from "../runtime/correction.mjs";
import { MODULE_ID } from "../constants.mjs";
import { useWithoutDas } from "../runtime/vanilla.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { tokenArt } from "../adapter/token-art.mjs";

const windowId = "das-correction";
let CorrectionClass = null;

/** Ce qu'on garde d'une correction à l'autre sur ce client. */
let remembered = { damage: "random", attack: "hit", save: "failed", concentration: true, effects: true, consume: false, public: false };

const usable = item => (item?.system?.activities?.contents ?? []).filter(a => a.canUse !== false);

const CorrectionApp = () => CorrectionClass ??= class CorrectionApp extends foundry.applications.api.ApplicationV2 {
  constructor(subject, options={}) {
    super({ ...options, id: windowId });
    this.item = subject?.documentName === "Item" ? subject : subject?.item;
    const list = usable(this.item);
    this.activityId = (subject?.documentName === "Item" ? list[0]?.id : subject?.id) ?? null;
    this.values = { ...remembered, level: null, zone: "targets" };
  }

  static DEFAULT_OPTIONS = {
    classes: ["das-screen", "das-group-roll", "das-correction"],
    window: { icon: "fa-solid fa-screwdriver-wrench", resizable: true },
    position: { width: 480, height: "auto" },
    actions: {
      apply: CorrectionApp.#apply,
      refresh: function() { this.#read(); this.render(); }
    }
  };

  get title() {
    return loc("Correction.Titre", { name: this.item?.name ?? "" });
  }

  get activity() {
    return this.item?.system.activities.get(this.activityId) ?? null;
  }

  async _renderHTML() {
    const v = this.values;
    const activity = this.activity;
    if ( !activity ) return `<p class="das-muted">${esc(loc("Correction.SansActivite"))}</p>`;
    const shape = correctionShape(activity);
    if ( !shape.levels.includes(Number(v.level)) ) v.level = shape.level;
    const zone = shape.zone && (v.zone === "zone");
    const select = (name, values, current, prefix) => `<select name="${name}">${values.map(x =>
      `<option value="${x}" ${String(current) === String(x) ? "selected" : ""}>${esc(prefix ? loc(`${prefix}.${x}`) : String(x))}</option>`).join("")}</select>`;
    const check = (name, label, on, disabled=false) => `<label class="check"><input type="checkbox" name="${name}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""}> ${esc(loc(label))}</label>`;
    const activities = usable(this.item);
    const targets = zone ? [] : correctionTargets(activity);
    const rows = [];
    if ( activities.length > 1 ) {
      rows.push(`<label class="wide">${esc(loc("Correction.Activite"))}<select name="activity">${activities.map(a =>
        `<option value="${a.id}" ${a.id === activity.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>`);
    }
    if ( shape.levels.length > 1 ) rows.push(`<label>${esc(loc("Correction.NiveauSort"))}${select("level", shape.levels, v.level)}</label>`);
    const zoneRow = shape.zone ? `<div class="das-group-roll__row modes">
        <label class="das-group-roll__mode"><input type="radio" name="zone" value="targets" ${zone ? "" : "checked"}> ${esc(loc("Correction.Zone.targets"))}</label>
        <label class="das-group-roll__mode"><input type="radio" name="zone" value="zone" ${zone ? "checked" : ""}> ${esc(loc("Correction.Zone.zone"))}</label>
      </div><p class="das-muted">${esc(loc(zone ? "Correction.Zone.AideZone" : "Correction.Zone.AideCibles"))}</p>` : "";
    const outcomes = [];
    if ( !zone && shape.attack ) outcomes.push(`<label>${esc(loc("Correction.Attaque.Libelle"))}${select("attack", ATTACK_OUTCOMES, v.attack, "Correction.Attaque")}</label>`);
    if ( !zone && shape.save ) outcomes.push(`<label>${esc(loc("Correction.Sauvegarde.Libelle"))}${select("save", SAVE_OUTCOMES, v.save, "Correction.Sauvegarde")}</label>`);
    if ( !zone && shape.damage ) outcomes.push(`<label>${esc(loc("Correction.Degats.Libelle"))}${select("damage", DAMAGE_MODES, v.damage, "Correction.Degats")}</label>`);
    const people = targets.map(t => `<div class="das-group-roll__actor on"><img src="${esc(tokenArt(t))}" alt="">
      <span class="name">${esc(t.name)}</span></div>`).join("");
    return `<form class="das-group-roll__body" autocomplete="off">
      <p class="das-muted">${esc(loc("Correction.Aide", { actor: activity.actor?.name ?? "" }))}</p>
      ${rows.length ? `<div class="das-group-roll__row">${rows.join("")}</div>` : ""}
      ${zoneRow}
      ${outcomes.length ? `<div class="das-group-roll__row">${outcomes.join("")}</div>` : ""}
      <div class="das-group-roll__row">
        ${shape.concentration ? check("concentration", "Correction.Concentration", v.concentration) : ""}
        ${(!zone && shape.effects) ? check("effects", "Correction.Effets", v.effects) : ""}
        ${check("consume", "Correction.Consommation", v.consume)}
      </div>
      ${zone ? "" : `<fieldset class="das-group-roll__actors">
        <legend>${esc(loc("Correction.Cibles"))}
          <button type="button" class="das-link" data-action="refresh">${esc(loc("Correction.Actualiser"))}</button></legend>
        ${people || `<p class="das-muted">${esc(loc("Correction.AucuneCible"))}</p>`}
      </fieldset>`}
      ${check("public", "Correction.Public", v.public)}
      <footer class="das-group-roll__foot">
        <button type="button" class="das-button" data-action="apply"><i class="fa-solid fa-screwdriver-wrench"></i>${esc(loc(zone ? "Correction.PoserZone" : "Correction.Appliquer"))}</button>
      </footer>
    </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const form = content.querySelector("form");
    if ( !form ) return;
    form.addEventListener("submit", event => event.preventDefault());
    form.addEventListener("change", event => {
      this.#read();
      if ( ["activity", "zone", "level"].includes(event.target.name) ) this.render();
    });
  }

  #read() {
    const form = this.element?.querySelector("form");
    if ( !form ) return;
    const f = form.elements;
    if ( f.activity ) this.activityId = f.activity.value;
    const value = (name, fallback) => f[name]?.value ?? fallback;
    const checked = (name, fallback) => (f[name] && !f[name].disabled ? f[name].checked : fallback);
    Object.assign(this.values, {
      level: value("level", this.values.level), attack: value("attack", this.values.attack), save: value("save", this.values.save),
      damage: value("damage", this.values.damage), zone: form.querySelector("input[name=zone]:checked")?.value ?? this.values.zone,
      concentration: checked("concentration", this.values.concentration), effects: checked("effects", this.values.effects),
      consume: checked("consume", this.values.consume), public: checked("public", this.values.public)
    });
  }

  static async #apply() {
    this.#read();
    const v = this.values;
    const { level, zone, ...keep } = v;
    remembered = keep;
    const activity = this.activity;
    if ( !activity ) return;
    const result = await applyCorrection({ ...v, activity: activity.uuid });
    if ( !result.ok ) return ui.notifications.warn(loc(`Correction.Erreur.${result.reason}`));
    ui.notifications.info(loc("Correction.Faite", { name: activity.item.name }));
    this.close();
  }
};

/** Ouvre la fenêtre de correction (MJ) sur un objet ou une activité. */
export function openCorrection(subject) {
  if ( !game.user.isGM ) return null;
  const item = subject?.documentName === "Item" ? subject : subject?.item;
  if ( !usable(item).length ) return ui.notifications.warn(loc("Correction.SansActivite"));
  foundry.applications.instances.get(windowId)?.close();
  return new (CorrectionApp())(subject).render({ force: true });
}

/** Les deux entrées du menu d'un objet de la fiche. */
function onItemContext(item, options) {
  if ( !Array.isArray(options) || !item?.actor || !usable(item).length ) return;
  if ( item.isOwner ) {
    options.push({ label: loc("SansDAS.Menu"), icon: "fa-solid fa-dice-d20", group: "action",
      onClick: event => { useWithoutDas(item, { event }); } });
  }
  if ( game.user.isGM ) {
    options.push({ label: loc("Correction.Menu"), icon: "fa-solid fa-screwdriver-wrench", group: "action",
      onClick: () => { openCorrection(item); } });
  }
}

/**
 * La carte d'une correction (la nôtre, ou celle de dnd5e pour une zone remise) : un bouton « Annuler » pour le MJ, ou la mention
 * « Correction annulée ». `always` : le routeur saute les hooks d'une carte de correction (adapter/vanilla-state.mjs).
 */
function onRenderCard(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !root ) return;
  const undone = message.getFlag(MODULE_ID, "correctionUndone") === true;
  const undo = undoOf(message);
  if ( !undone && !undo ) return;
  const content = root.querySelector(".message-content") ?? root;
  content.querySelector(".das-correction-undo, .das-correction-undone")?.remove();
  if ( undone ) {
    content.insertAdjacentHTML("beforeend", `<p class="das-correction-undone"><i class="fa-solid fa-rotate-left"></i> ${esc(loc("Correction.Annulee"))}</p>`);
    return;
  }
  if ( !game.user.isGM ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "das-correction-undo";
  button.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${esc(loc("Correction.Annuler"))}`;
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    const ok = await undoCorrection(message.id).catch(err => { console.error(`${MODULE_ID} | correction: undo failed`, err); return false; });
    if ( ok ) ui.notifications.info(loc("Correction.AnnuleeNotif"));
    else button.disabled = false;
  });
  content.append(button);
}

export function registerCorrectionUi() {
  route("dnd5e.getItemContextOptions", onItemContext, { label: "correction / without DAS: no menu entry" });
  route("dnd5e.renderChatMessage", onRenderCard, { always: true, label: "correction: undo button not shown" });
}


/**
 * §222 : les bottes choisies, à l'écran.
 *
 *  - **Fiche** (`renderBaseActorSheet`, pour tous) : chaque arme qui porte une botte reçoit une pastille — vive quand le personnage la
 *    maîtrise (dnd5e : `masteryOptions`, data/item/weapon.mjs:331, non vide), terne sinon ; l'infobulle dit pourquoi, et un clic ouvre
 *    la fenêtre des bottes.
 *  - **Fenêtre des bottes** : le compte (choisies / permises), d'où viennent les places (classes, dons), ce qu'un Repos long laisse
 *    changer, les armes que le personnage maîtrise, groupées par type, cochables, avec leur botte ; « Réinitialiser » décoche tout, la
 *    règle juge le choix final (runtime/mastery-choices.mjs) avant « Enregistrer ».
 *  - **Aptitude** : utiliser « Bottes d'arme » d'une classe ou le don « Maître d'armes » (sans activité : dnd5e afficherait sa carte,
 *    `dnd5e.preDisplayCardV2`, documents/item.mjs:805) ouvre la fenêtre à la place.
 *  - **Repos long** (`dnd5e-combat.masteryRest`) : la fenêtre s'ouvre chez le joueur de l'acteur (requête), sinon sur ce client.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc, log } from "../runtime/shared.mjs";
import { judgeMasteries, masteryRulesOn } from "../runtime/mastery-choices.mjs";
import { masterySlots } from "../core/mastery.mjs";
import { MASTERY_FEATURES, chosenMasteries, masterySourcesOf, restAllowanceOf, baseWeapons, proficientWith } from "../adapter/mastery.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { playerOwnerOf } from "../adapter/contest.mjs";

const PATH = "system.traits.weaponProf.mastery.value";
const BADGE = "das-mastery-badge";
export const MASTERY_WINDOW_QUERY = `${MODULE_ID}.masteryWindow`;

/** Le nom d'une botte (dnd5e, `CONFIG.DND5E.weaponMasteries`). */
const masteryLabel = key => CONFIG.DND5E.weaponMasteries?.[key]?.label ?? key;

/* -------------------------------------------- */
/*  Fenêtre                                     */
/* -------------------------------------------- */

const windowId = actor => `das-mastery-${actor.id}`;
let MasteryClass = null;

const MasteryApp = () => MasteryClass ??= class MasteryApp extends foundry.applications.api.ApplicationV2 {
  constructor(actor, options={}) {
    super({ ...options, id: windowId(actor) });
    this.actor = actor;
    /** Le choix en cours (pas encore enregistré). */
    this.selection = new Set(chosenMasteries(actor));
  }

  static DEFAULT_OPTIONS = {
    classes: ["das-screen", "das-mastery"],
    window: { icon: "fa-solid fa-sword", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      reset: MasteryApp.#reset,
      revert: MasteryApp.#revert,
      save: MasteryApp.#save
    }
  };

  get title() {
    return loc("Bottes.Titre", { name: this.actor.name });
  }

  async _renderHTML() {
    const actor = this.actor;
    const weapons = await baseWeapons();
    const sources = masterySourcesOf(actor);
    const slots = masterySlots(sources);
    const allowance = restAllowanceOf(actor);
    const rules = masteryRulesOn();
    const verdict = judgeMasteries(actor, [...this.selection]);
    const editable = actor.isOwner;
    const held = new Set(actor.items.filter(i => i.type === "weapon").map(i => i.system.type?.baseItem).filter(Boolean));
    const chosen = this.selection.size;

    const sourceText = sources.length
      ? sources.map(s => esc(loc(s.melee ? "Bottes.SourceMelee" : "Bottes.Source", { label: s.label, count: s.count }))).join(" · ")
      : esc(loc("Bottes.AucuneSource"));
    const notes = [];
    if ( rules && allowance ) notes.push(`<p class="das-mastery__rest"><i class="fa-solid fa-campground"></i> ${esc(loc("Bottes.Repos", { count: allowance }))}</p>`);
    else if ( rules && !game.user.isGM ) notes.push(`<p class="das-muted"><i class="fa-solid fa-campground"></i> ${esc(loc("Bottes.HorsRepos"))}</p>`);
    if ( verdict.ok && (chosen < slots) ) notes.push(`<p class="das-muted">${esc(loc("Bottes.Reste", { count: slots - chosen }))}</p>`);
    if ( !verdict.ok ) notes.push(`<p class="das-mastery__ko"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(loc(`Bottes.Refus.${verdict.reason}`,
      { name: actor.name, slots, allowance }))}${game.user.isGM ? ` ${esc(loc("Bottes.MJLibre"))}` : ""}</p>`);

    // Les armes que le personnage maîtrise, et celles déjà choisies (maîtrise perdue depuis) ; par type de dnd5e.
    const groups = new Map();
    for ( const w of weapons ) {
      if ( !proficientWith(actor, w) && !this.selection.has(w.key) ) continue;
      const type = `${w.category === "mar" ? "martial" : "simple"}${w.melee ? "M" : "R"}`;
      if ( !groups.has(type) ) groups.set(type, []);
      groups.get(type).push(w);
    }
    const order = ["simpleM", "simpleR", "martialM", "martialR"];
    const lists = order.filter(t => groups.has(t)).map(type => `
      <fieldset class="das-mastery__group">
        <legend>${esc(CONFIG.DND5E.weaponTypes?.[type] ?? type)}</legend>
        ${groups.get(type).map(w => {
          const on = this.selection.has(w.key);
          return `<label class="das-mastery__weapon${on ? " on" : ""}">
            <input type="checkbox" data-key="${esc(w.key)}" ${on ? "checked" : ""} ${editable ? "" : "disabled"}>
            <span class="name">${esc(w.label)}${held.has(w.key) ? ` <i class="fa-solid fa-hand" data-tooltip="${esc(loc("Bottes.Tenue"))}"></i>` : ""}</span>
            ${w.mastery ? `<span class="property">${esc(masteryLabel(w.mastery))}</span>` : ""}
          </label>`;
        }).join("")}
      </fieldset>`).join("");

    const over = rules && (chosen > slots);
    const blocked = rules && !verdict.ok && !game.user.isGM;
    return `<div class="das-mastery__body">
      <header class="das-mastery__head">
        <div class="das-mastery__count${over ? " over" : ""}"><strong>${chosen}</strong> / ${slots}</div>
        <div>
          <p class="das-lead">${esc(loc("Bottes.Compte", { chosen, slots }))}</p>
          <p class="das-muted">${sourceText}</p>
        </div>
      </header>
      ${notes.join("")}
      <div class="das-mastery__lists">${lists || `<p class="das-muted">${esc(loc("Bottes.AucuneArme"))}</p>`}</div>
      ${editable ? `<footer class="das-mastery__foot">
        <button type="button" class="das-button ghost" data-action="reset"><i class="fa-solid fa-rotate-left"></i>${esc(loc("Bottes.Reinitialiser"))}</button>
        <button type="button" class="das-button ghost" data-action="revert">${esc(loc("Bottes.Annuler"))}</button>
        <button type="button" class="das-button" data-action="save" ${blocked ? "disabled" : ""}><i class="fa-solid fa-check"></i>${esc(loc("Bottes.Enregistrer"))}</button>
      </footer>` : ""}
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelectorAll("input[data-key]").forEach(input => input.addEventListener("change", () => {
      if ( input.checked ) this.selection.add(input.dataset.key);
      else this.selection.delete(input.dataset.key);
      this.render();
    }));
  }

  /** « Réinitialiser » : aucune botte cochée ; rien n'est écrit avant « Enregistrer ». */
  static #reset() {
    this.selection.clear();
    this.render();
  }

  /** Revenir au choix enregistré. */
  static #revert() {
    this.selection = new Set(chosenMasteries(this.actor));
    this.render();
  }

  static async #save() {
    const keys = [...this.selection];
    const before = chosenMasteries(this.actor);
    if ( (keys.length === before.length) && keys.every(k => before.includes(k)) ) return this.close();
    await this.actor.update({ [PATH]: keys });
    // Refusé par la règle (runtime/mastery-choices.mjs) : la fiche garde l'ancien choix, la fenêtre reste ouverte.
    const saved = chosenMasteries(this.actor);
    if ( (saved.length === keys.length) && keys.every(k => saved.includes(k)) ) {
      ui.notifications.info(loc("Bottes.Enregistre", { name: this.actor.name, list: keys.map(k => labelOf(k)).join(", ") || "—" }));
      return this.close();
    }
    this.render();
  }
};

let labels = new Map();
const labelOf = key => labels.get(key) ?? key;

/** Ouvre la fenêtre des bottes d'un acteur (une par acteur ; déjà ouverte, elle passe devant). */
export async function openMasteries(actor) {
  if ( !actor ) return null;
  if ( !labels.size ) labels = new Map((await baseWeapons()).map(w => [w.key, w.label]));
  const open = foundry.applications.instances.get(windowId(actor));
  if ( open ) return open.render({ force: true });
  return new (MasteryApp())(actor).render({ force: true });
}

/** Sur le client du joueur : la fenêtre ouverte à la demande du client qui a lancé le repos. */
async function handleWindowQuery({ actor: uuid }) {
  const actor = await fromUuid(uuid);
  if ( !actor?.isOwner ) return false;
  await openMasteries(actor);
  return true;
}

/* -------------------------------------------- */
/*  Fiche                                       */
/* -------------------------------------------- */

function badgeTooltip(item, active) {
  const lines = [`<strong>${esc(loc(active ? "Bottes.Pastille.Active" : "Bottes.Pastille.Inactive", { mastery: masteryLabel(item.system.mastery) }))}</strong>`];
  const options = item.system.masteryOptions ?? [];
  if ( active && (options.length > 1) ) lines.push(esc(loc("Bottes.Pastille.Options", { list: options.map(o => o.label).join(", ") })));
  if ( !active ) lines.push(esc(loc(item.system.type?.baseItem ? "Bottes.Pastille.Choisir" : "Bottes.Pastille.SansBase")));
  lines.push(`<em>${esc(loc("Bottes.Pastille.Clic"))}</em>`);
  return lines.join("<br>");
}

function decorate(app, element) {
  element.querySelectorAll(`.${BADGE}`).forEach(n => n.remove());
  const actor = app.document;
  if ( !(actor instanceof Actor) || !actor.items ) return;
  for ( const row of element.querySelectorAll("[data-item-id]") ) {
    const item = actor.items.get(row.dataset.itemId);
    if ( (item?.type !== "weapon") || !item.system.mastery ) continue;
    const name = row.querySelector(":scope > .item-row .item-name");
    if ( !name ) continue;
    const active = (item.system.masteryOptions?.length ?? 0) > 0;
    const badge = document.createElement("a");
    badge.className = `${BADGE}${active ? " active" : ""}`;
    badge.setAttribute("role", "button");
    badge.dataset.tooltipHtml = badgeTooltip(item, active);
    badge.dataset.tooltipDirection = "UP";
    badge.innerHTML = `<i class="fa-solid ${active ? "fa-sword" : "fa-lock"}"></i>${esc(masteryLabel(item.system.mastery))}`;
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    badge.addEventListener("pointerdown", ev => ev.stopPropagation());
    badge.addEventListener("dragstart", stop);
    badge.addEventListener("click", ev => { stop(ev); openMasteries(actor); });
    const title = name.querySelector(":scope > .name");
    if ( title ) title.after(badge);
    else name.append(badge);
  }
}

/* -------------------------------------------- */
/*  Aptitude, repos                             */
/* -------------------------------------------- */

function onPreDisplayCard(item) {
  if ( !item?.actor || (item.system.activities?.size ?? 0) ) return true;
  if ( !MASTERY_FEATURES.includes(identifierOf(item).id) ) return true;
  openMasteries(item.actor);
  return false;
}

function onMasteryRest(actor) {
  const player = playerOwnerOf(actor);
  if ( player && !player.isSelf ) {
    player.query(MASTERY_WINDOW_QUERY, { actor: actor.uuid }, { timeout: 30000 }).catch(() => null);
    log(`${actor.name}: weapon mastery window opened for ${player.name}`);
    return;
  }
  openMasteries(actor);
}

/**
 * Rafraîchit la fenêtre des bottes ouverte pour cet acteur : ses bottes enregistrées ont changé (le choix en cours repart d'elles),
 * ou ce que le Repos long laisse changer (le choix en cours est gardé).
 */
function refresh(actor, changes) {
  const open = foundry.applications.instances.get(windowId(actor));
  if ( !open ) return;
  if ( foundry.utils.hasProperty(changes, "system.traits.weaponProf") ) open.selection = new Set(chosenMasteries(actor));
  else if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.masteryRest`)
    && !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.-=masteryRest`) ) return;
  open.render();
}

export const masteryApi = Object.freeze({
  open: actor => openMasteries(actor),
  sources: actor => masterySourcesOf(actor),
  judge: (actor, keys) => judgeMasteries(actor, keys)
});

export function registerMasteryUI() {
  // Sur tous les clients : c'est celui du joueur qui ouvre sa fenêtre.
  CONFIG.queries[MASTERY_WINDOW_QUERY] = handleWindowQuery;
  route("renderBaseActorSheet", (app, element) => decorate(app, element), { label: "weapon mastery badges", level: "warn" });
  route("dnd5e.preDisplayCardV2", onPreDisplayCard, { cancellable: true, label: "weapon mastery window not opened" });
  route(`${MODULE_ID}.masteryRest`, onMasteryRest, { label: "weapon mastery window not opened after a Long Rest" });
  route("updateActor", (actor, changes) => refresh(actor, changes), { label: "weapon mastery window not refreshed" });
}

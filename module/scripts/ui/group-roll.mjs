/**
 * §242 (issue #18) : les jets demandés par le MJ, à l'écran.
 *
 *  - **Fenêtre de demande** (MJ) : le libellé (« Sauter le pont »), le type de jet (test de caractéristique, sauvegarde, compétence,
 *    outil) et ce qu'on lance, les personnages concernés (le groupe de dnd5e, les personnages des joueurs, plus les tokens sélectionnés
 *    ou celui d'où l'on vient ; un point vert pour un joueur connecté), le DD (facultatif, caché ou non aux joueurs), Avantage /
 *    Désavantage, un modificateur fixe et le test de groupe 2024. « Demander » passe à runtime/group-roll.mjs.
 *  - **Où l'ouvrir** : un dé dans la barre d'outils des tokens, un bouton du HUD d'un token (clic droit du cœur), l'entrée « Demander un
 *    jet » du menu du moteur sur un personnage (ui/pointer-menu.mjs), et `api.rolls.open({ actors })`.
 *  - **Carte** : la carte de demande de dnd5e, complétée — le DD (« caché » pour les joueurs), les réussites que dnd5e ne marque pas
 *    (DD caché : les jets n'en portent pas, seul le MJ les voit), et le verdict du groupe.
 */

import { MODULE_ID } from "../constants.mjs";
import { ROLL_TYPES } from "../core/group-roll.mjs";
import { requestOf, viewOf, toolLabel } from "../adapter/group-roll.mjs";
import { requestGroupRoll } from "../runtime/group-roll.mjs";
import { openTracker } from "./group-roll-tracker.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

/* -------------------------------------------- */
/*  Fenêtre de demande                          */
/* -------------------------------------------- */

/** Le dernier choix du MJ sur ce client, repris à l'ouverture suivante (sauf les personnages). */
let remembered = { type: "skill", key: "ath", dc: "", hideDc: false, mode: "normal", bonus: "", group: false };

/** Ce qu'on peut lancer pour chaque type, trié par nom. */
function keyChoices(type) {
  const sort = list => list.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  if ( (type === "check") || (type === "save") ) {
    return Object.entries(CONFIG.DND5E.abilities ?? {}).map(([value, a]) => ({ value, label: game.i18n.localize(a.label) }));
  }
  if ( type === "skill" ) return sort(Object.entries(CONFIG.DND5E.skills ?? {}).map(([value, s]) => ({ value, label: game.i18n.localize(s.label) })));
  return sort(Object.keys(CONFIG.DND5E.tools ?? {}).map(value => ({ value, label: toolLabel(value) })));
}

/** Les joueurs (non MJ) qui possèdent l'acteur. */
const ownersOf = actor => game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));

/** Les personnages proposés : le groupe de dnd5e, ceux des joueurs, puis ceux qu'on apporte (tokens sélectionnés…). */
function candidates(extra=[]) {
  const out = new Map();
  const add = actor => { if ( actor?.system?.abilities && !out.has(actor.uuid) ) out.set(actor.uuid, actor); };
  for ( const member of game.actors.party?.system?.members ?? [] ) add(member.actor ?? member);
  for ( const user of game.users ) if ( !user.isGM ) add(user.character);
  for ( const actor of extra ) add(actor);
  return [...out.values()];
}

const windowId = "das-group-roll";
let GroupRollClass = null;

const GroupRollApp = () => GroupRollClass ??= class GroupRollApp extends foundry.applications.api.ApplicationV2 {
  /** @param {{actors?: Actor[]}} [preset]  Les personnages cochés d'office ; sans eux, ceux des joueurs connectés. */
  constructor(preset={}, options={}) {
    super({ ...options, id: windowId });
    this.preset = preset.actors ?? [];
    this.values = { label: "", ...remembered, ...(preset.values ?? {}) };
    const list = candidates(this.preset);
    const online = list.filter(a => ownersOf(a).some(u => u.active));
    const start = this.preset.length ? this.preset : (online.length ? online : list);
    this.chosen = new Set(start.map(a => a.uuid));
  }

  static DEFAULT_OPTIONS = {
    classes: ["das-screen", "das-group-roll"],
    window: { icon: "fa-solid fa-dice-d20", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      send: GroupRollApp.#send,
      tracker: () => openTracker(),
      pick: GroupRollApp.#pick
    }
  };

  get title() {
    return loc("JetGroupe.Titre");
  }

  async _renderHTML() {
    const v = this.values;
    const types = ROLL_TYPES.map(t => `<option value="${t}" ${v.type === t ? "selected" : ""}>${esc(loc(`JetGroupe.Type.${t}`))}</option>`).join("");
    const keys = keyChoices(v.type);
    if ( !keys.some(k => k.value === v.key) ) v.key = keys[0]?.value ?? "";
    const keyOptions = keys.map(k => `<option value="${esc(k.value)}" ${v.key === k.value ? "selected" : ""}>${esc(k.label)}</option>`).join("");
    const modes = ["advantage", "normal", "disadvantage"].map(m => `<label class="das-group-roll__mode">
      <input type="radio" name="mode" value="${m}" ${v.mode === m ? "checked" : ""}> ${esc(loc(`JetGroupe.Mode.${m}`))}</label>`).join("");
    const people = candidates(this.preset).map(actor => {
      const owners = ownersOf(actor);
      const online = owners.some(u => u.active);
      const who = owners.length ? owners.map(u => esc(u.name)).join(", ") : esc(loc("JetGroupe.SansJoueur"));
      const on = this.chosen.has(actor.uuid);
      return `<label class="das-group-roll__actor${on ? " on" : ""}">
        <input type="checkbox" data-uuid="${esc(actor.uuid)}" ${on ? "checked" : ""}>
        <img src="${esc(actor.img)}" alt="">
        <span class="name">${esc(actor.name)}<small><i class="fa-solid fa-circle ${online ? "online" : "offline"}"></i> ${who}</small></span>
      </label>`;
    }).join("");
    return `<form class="das-group-roll__body" autocomplete="off">
      <div class="das-group-roll__row">
        <label class="wide">${esc(loc("JetGroupe.Libelle"))}
          <input type="text" name="label" value="${esc(v.label)}"></label>
      </div>
      <div class="das-group-roll__row">
        <label>${esc(loc("JetGroupe.TypeJet"))}<select name="type">${types}</select></label>
        <label class="wide">${esc(loc(`JetGroupe.Cle.${v.type}`))}<select name="key">${keyOptions}</select></label>
      </div>
      <div class="das-group-roll__row">
        <label>${esc(loc("JetGroupe.DD"))}<input type="number" name="dc" min="0" max="40" value="${esc(v.dc)}" placeholder="—"></label>
        <label class="check"><input type="checkbox" name="hideDc" ${v.hideDc ? "checked" : ""}> ${esc(loc("JetGroupe.DDCache"))}</label>
        <label>${esc(loc("JetGroupe.Bonus"))}<input type="number" name="bonus" min="-20" max="20" value="${esc(v.bonus)}" placeholder="0"></label>
      </div>
      <div class="das-group-roll__row modes">${modes}</div>
      <label class="check"><input type="checkbox" name="group" ${v.group ? "checked" : ""}> ${esc(loc("JetGroupe.Groupe"))}</label>
      <p class="das-muted">${esc(loc("JetGroupe.GroupeAide"))}</p>
      <fieldset class="das-group-roll__actors">
        <legend>${esc(loc("JetGroupe.Personnages"))}
          <button type="button" class="das-link" data-action="pick" data-pick="online">${esc(loc("JetGroupe.Connectes"))}</button>
          <button type="button" class="das-link" data-action="pick" data-pick="all">${esc(loc("JetGroupe.Tous"))}</button>
          <button type="button" class="das-link" data-action="pick" data-pick="none">${esc(loc("JetGroupe.Aucun"))}</button>
        </legend>
        ${people || `<p class="das-muted">${esc(loc("JetGroupe.AucunPersonnage"))}</p>`}
      </fieldset>
      <footer class="das-group-roll__foot">
        <button type="button" class="das-button ghost" data-action="tracker"><i class="fa-solid fa-list-check"></i>${esc(loc("JetGroupe.Suivi.Bouton"))}</button>
        <button type="button" class="das-button" data-action="send" ${this.chosen.size ? "" : "disabled"}>
          <i class="fa-solid fa-dice-d20"></i>${esc(loc("JetGroupe.Demander", { count: this.chosen.size }))}</button>
      </footer>
    </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const form = content.querySelector("form");
    form.addEventListener("submit", event => event.preventDefault());
    form.addEventListener("change", event => {
      const input = event.target;
      if ( input.dataset.uuid ) {
        if ( input.checked ) this.chosen.add(input.dataset.uuid);
        else this.chosen.delete(input.dataset.uuid);
      }
      this.#read(form);
      // Le type change la liste de ce qu'on lance ; une case cochée change le compte du bouton.
      if ( (input.name === "type") || input.dataset.uuid ) this.render();
    });
  }

  /** Les valeurs du formulaire, gardées d'un rendu à l'autre. */
  #read(form) {
    const f = form.elements;
    Object.assign(this.values, {
      label: f.label.value, type: f.type.value, key: f.key.value, dc: f.dc.value, hideDc: f.hideDc.checked, bonus: f.bonus.value,
      mode: form.querySelector("input[name=mode]:checked")?.value ?? "normal", group: f.group.checked
    });
  }

  static #pick(event, target) {
    const list = candidates(this.preset);
    const which = target.dataset.pick;
    this.chosen = new Set(list.filter(a => (which === "all") || ((which === "online") && ownersOf(a).some(u => u.active))).map(a => a.uuid));
    this.#read(this.element.querySelector("form"));
    this.render();
  }

  static async #send() {
    this.#read(this.element.querySelector("form"));
    const v = this.values;
    const actors = [...this.chosen].map(uuid => fromUuidSync(uuid)).filter(Boolean);
    if ( !actors.length ) return;
    const { label, ...kept } = v;   // le libellé ne se garde pas d'une demande à l'autre
    remembered = kept;
    this.close();
    try {
      await requestGroupRoll({ actors, type: v.type, key: v.key, dc: v.dc, hideDc: v.hideDc, bonus: v.bonus, label: v.label, group: v.group,
        advantage: v.mode === "advantage", disadvantage: v.mode === "disadvantage" });
    } catch(err) {
      console.error(err);
      ui.notifications.error(loc("JetGroupe.Erreur"));
    }
  }
};

/**
 * Ouvre la fenêtre de demande (MJ). `actors` : acteurs, tokens ou uuid cochés d'office ; `values` : les champs pré-remplis
 * (`type`, `key`, `dc`, `hideDc`, `mode`, `bonus`, `label`, `group`).
 */
export function openGroupRoll({ actors=[], values={} }={}) {
  if ( !game.user.isGM ) return null;
  const list = actors.map(a => (typeof a === "string") ? fromUuidSync(a) : (a?.actor ?? a)).filter(a => a instanceof Actor);
  foundry.applications.instances.get(windowId)?.close();
  const app = new (GroupRollApp())({ actors: list, values });
  app.render({ force: true });
  return app;
}

/** Les acteurs des tokens sélectionnés, plus celui d'où l'on vient. */
function withSelection(token=null) {
  const list = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
  if ( token?.actor && !list.includes(token.actor) ) list.push(token.actor);
  return list;
}

/** L'entrée du menu du moteur sur un personnage (ui/pointer-menu.mjs), MJ seulement. */
export function groupRollEntry(target) {
  if ( !game.user.isGM || !target?.actor?.system?.abilities ) return null;
  return { icon: "fa-solid fa-dice-d20", label: loc("JetGroupe.Menu"), run: () => openGroupRoll({ actors: withSelection(target) }) };
}

function onTokenHUD(hud, html) {
  if ( !game.user.isGM ) return;
  const token = hud.document;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  if ( !token?.actor?.system?.abilities || !column ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon das-group-roll-hud";
  button.dataset.tooltip = loc("JetGroupe.Menu");
  button.innerHTML = `<i class="fa-solid fa-dice-d20"></i>`;
  button.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation();
    openGroupRoll({ actors: withSelection(token) });
  });
  column.append(button);
}

/* -------------------------------------------- */
/*  Carte                                       */
/* -------------------------------------------- */

function onRenderCard(message, html) {
  if ( !requestOf(message) ) return;
  const view = viewOf(message);
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !view || !root ) return;
  root.classList.add("das-group-roll-card");
  const gm = game.user.isGM;
  const { request } = view;
  const lines = [];
  if ( request.label ) lines.push(`<p class="das-group-roll__label">${esc(request.label)}</p>`);
  if ( request.dc !== null ) {
    const dc = (request.hideDc && !gm) ? loc("JetGroupe.CarteDDCache") : loc(request.hideDc ? "JetGroupe.CarteDDCacheMJ" : "JetGroupe.CarteDD", { dc: request.dc });
    lines.push(`<p class="das-group-roll__dc">${esc(dc)}</p>`);
  }
  const tags = [];
  if ( request.advantage ) tags.push(loc("JetGroupe.Mode.advantage"));
  if ( request.disadvantage ) tags.push(loc("JetGroupe.Mode.disadvantage"));
  if ( request.bonus ) tags.push(`${request.bonus > 0 ? "+" : ""}${request.bonus}`);
  if ( request.group ) tags.push(loc("JetGroupe.CarteGroupe"));
  if ( tags.length ) lines.push(`<p class="das-group-roll__tags">${tags.map(esc).join(" · ")}</p>`);
  const content = root.querySelector(".message-content") ?? root;
  content.querySelector(".das-group-roll__head")?.remove();
  const head = document.createElement("div");
  head.className = "das-group-roll__head";
  head.innerHTML = lines.join("");
  content.prepend(head);

  // Le total et la réussite de chaque ligne sont les nôtres : dnd5e ne lit que le jet (sans le dé d'Inspiration bardique ajouté ensuite), et
  // avec un DD caché les jets n'ont pas de cible — dnd5e ne marque rien. Au MJ toujours, aux joueurs quand le DD n'est pas caché.
  for ( const item of root.querySelectorAll(".targets [data-uuid]") ) {
    const entry = view.entries.find(e => e.uuid === item.dataset.uuid);
    const status = item.querySelector(".status");
    if ( !status || !entry ) continue;
    // En décision : le jet est là, le dé d'Inspiration bardique pas encore tranché.
    const raw = status.querySelector(".total");
    if ( entry.deciding && raw ) {
      raw.textContent = `${entry.rolled}…`;
      raw.dataset.tooltip = loc("JetGroupe.CarteDecision");
    }
    if ( entry.status !== "rolled" ) continue;
    const total = status.querySelector(".total");
    if ( total && entry.bonus ) {
      total.textContent = String(entry.total);
      total.dataset.tooltip = loc("JetGroupe.CarteBonus", { bonus: entry.bonus });
    }
    if ( (entry.success === null) || (request.hideDc && !gm) ) continue;
    status.classList.toggle("success", entry.success);
    status.classList.toggle("failure", !entry.success);
    status.querySelectorAll(".fa-check, .fa-xmark").forEach(i => i.remove());
    status.append(foundry.applications.fields.createFontAwesomeIcon(entry.success ? "check" : "xmark"));
  }
  // Le verdict : au MJ toujours, aux joueurs quand le DD n'est pas caché.
  root.querySelector(".das-group-roll__verdict")?.remove();
  if ( (view.success !== null) && (gm || !request.hideDc) ) {
    const verdict = document.createElement("p");
    verdict.className = `das-group-roll__verdict ${view.success ? "success" : "failure"}`;
    const key = request.group ? (view.success ? "VerdictGroupeReussi" : "VerdictGroupeRate") : (view.success ? "VerdictReussi" : "VerdictRate");
    verdict.textContent = loc(`JetGroupe.${key}`, { successes: view.successes, count: view.entries.length });
    content.append(verdict);
  }
}

export function registerGroupRollUI() {
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-group-roll"] = { name: "das-group-roll", order: last + 1, icon: "fa-solid fa-dice-d20", title: "DND5ECOMBAT.JetGroupe.Titre",
      button: true, visible: true, onChange: () => openGroupRoll({ actors: withSelection() }) };
  }, { always: true, label: "group roll: tool" });
  route("renderTokenHUD", onTokenHUD, { always: true, label: "group roll: token HUD" });
  route("dnd5e.renderChatMessage", onRenderCard, { always: true, label: "group roll: card" });
}

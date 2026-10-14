/**
 * §181 : la fenêtre des factions (MJ) — la matrice des relations, et l'affectation par glisser-déposer.
 *
 * - **Matrice** : une ligne et une colonne par faction ; un clic sur une case fait tourner la relation du couple :
 *   « = » (suivre la disposition) → hostile → neutre → alliée → « = ». La matrice est symétrique.
 * - **Affecter** : glisser un acteur de la barre latérale sur la ligne d'une faction (vaut pour tous ses tokens) ; glisser la
 *   pastille d'une faction sur un token de la scène (ce token seulement) ; bouton « sélection » d'une ligne (tokens contrôlés) ;
 *   la zone « Aucune » retire l'affectation (retour aux règles par type).
 * - **Éditer** : nom, couleur, règles par type / sous-type / identifiant, supprimer ; « Relations suggérées ».
 * - Un bouton du HUD du token ouvre la liste des factions ; un outil de la barre des tokens ouvre la fenêtre.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";
import { PARTY, pairKey, RELATIONS } from "../core/factions.mjs";
import { factionSettings, factionName, factionOf, explicitFaction, NONE } from "../adapter/factions.mjs";
import { assignFaction, setRelation, addFaction, removeFaction, saveFactions, applySuggested } from "../runtime/factions.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const DRAG_TYPE = "DASFaction";
const CYCLE = [null, ...RELATIONS];
const ICON = { hostile: "fa-solid fa-swords", neutral: "fa-solid fa-minus", allied: "fa-solid fa-handshake" };

let FactionsClass = null;
let open = null;

/** Les tokens contrôlés sur le canevas, en documents. */
const selected = () => (canvas?.tokens?.controlled ?? []).map(t => t.document);

export const FactionsApp = () => FactionsClass ??= class FactionsApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "das-factions",
    classes: ["das-screen", "das-factions"],
    window: { title: "DND5ECOMBAT.Factions.Titre", icon: "fa-solid fa-flag", resizable: true },
    position: { width: 780, height: "auto" }
  };

  async _renderHTML() {
    const { factions, relations } = factionSettings();
    const scene = canvas?.scene ?? null;
    const counts = new Map();
    for ( const t of scene?.tokens ?? [] ) {
      const f = factionOf(t);
      if ( f ) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const chip = f => `<span class="das-faction-chip" draggable="true" data-drag-faction="${esc(f.id)}" style="--faction:${esc(f.color)}"
      data-tooltip="${esc(loc("Factions.GlisserToken"))}">${esc(factionName(f))}</span>`;
    const head = factions.map(f => `<th class="das-faction-col" style="--faction:${esc(f.color)}" data-tooltip="${esc(factionName(f))}">
      <span>${esc(factionName(f))}</span></th>`).join("");
    const rows = factions.map(a => {
      const cells = factions.map(b => {
        if ( a.id === b.id ) return `<td class="das-rel self"></td>`;
        const value = relations[pairKey(a.id, b.id)] ?? null;
        const title = loc(`Factions.Relation.${value ?? "disposition"}`);
        return `<td class="das-rel ${value ?? "disposition"}" data-a="${esc(a.id)}" data-b="${esc(b.id)}" data-tooltip="${esc(`${factionName(a)} ↔ ${factionName(b)} : ${title}`)}">
          ${value ? `<i class="${ICON[value]}"></i>` : "="}</td>`;
      }).join("");
      return `<tr class="das-faction-row" data-faction="${esc(a.id)}">
        <th class="das-faction-head">${chip(a)} <span class="das-muted">${counts.get(a.id) ?? 0}</span>
          <button type="button" class="das-icon" data-assign="${esc(a.id)}" data-tooltip="${esc(loc("Factions.AffecterSelection"))}"><i class="fa-solid fa-crosshairs"></i></button>
        </th>${cells}</tr>`;
    }).join("");
    const editors = factions.map(f => {
      const party = f.id === PARTY;
      const rules = k => esc((f.rules?.[k] ?? []).join(", "));
      return `<tr data-edit="${esc(f.id)}">
        <td><input type="color" name="color" value="${esc(f.color)}"></td>
        <td><input type="text" name="name" value="${esc(f.name)}" placeholder="${esc(factionName({ ...f, name: "" }))}"></td>
        <td><input type="text" name="types" value="${rules("types")}" ${party ? "disabled" : ""} placeholder="beast, undead"></td>
        <td><input type="text" name="subtypes" value="${rules("subtypes")}" ${party ? "disabled" : ""} placeholder="goblinoid"></td>
        <td><input type="text" name="identifiers" value="${rules("identifiers")}" ${party ? "disabled" : ""} placeholder="wolf"></td>
        <td>${party ? "" : `<button type="button" class="das-icon" data-remove="${esc(f.id)}" data-tooltip="${esc(loc("Factions.Supprimer"))}"><i class="fa-solid fa-trash"></i></button>`}</td>
      </tr>`;
    }).join("");
    const root = document.createElement("div");
    root.className = "das-factions__body";
    root.innerHTML = `
      <p class="das-muted">${esc(loc("Factions.Aide"))}</p>
      <div class="das-factions__matrix"><table>
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="das-factions__none" data-faction="${NONE}">
        <i class="fa-solid fa-ban"></i> ${esc(loc("Factions.ZoneAucune"))}
        <button type="button" class="das-button ghost" data-clear="selection">${esc(loc("Factions.RetirerSelection"))}</button>
      </div>
      <div class="das-factions__tools">
        <button type="button" class="das-button" data-action="add"><i class="fa-solid fa-plus"></i> ${esc(loc("Factions.Ajouter"))}</button>
        <button type="button" class="das-button ghost" data-action="suggest"><i class="fa-solid fa-lightbulb"></i> ${esc(loc("Factions.Suggerer"))}</button>
      </div>
      <details class="das-factions__edit"><summary>${esc(loc("Factions.Editer"))}</summary>
        <table><thead><tr><th></th><th>${esc(loc("Factions.Nom"))}</th><th>${esc(loc("Factions.Types"))}</th>
          <th>${esc(loc("Factions.SousTypes"))}</th><th>${esc(loc("Factions.Identifiants"))}</th><th></th></tr></thead>
          <tbody>${editors}</tbody></table>
        <p class="das-muted">${esc(loc("Factions.AideRegles"))}</p>
        <button type="button" class="das-button" data-action="save"><i class="fa-solid fa-floppy-disk"></i> ${esc(loc("Factions.Enregistrer"))}</button>
      </details>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this.#listen(content);
  }

  #listen(root) {
    const rerender = () => this.render();
    root.querySelectorAll("td.das-rel[data-a]").forEach(td => td.addEventListener("click", async () => {
      const value = factionSettings().relations[pairKey(td.dataset.a, td.dataset.b)] ?? null;
      const next = CYCLE[(CYCLE.indexOf(value) + 1) % CYCLE.length];
      await setRelation(td.dataset.a, td.dataset.b, next);
      rerender();
    }));
    root.querySelectorAll("[data-assign]").forEach(b => b.addEventListener("click", async () => {
      const tokens = selected();
      if ( !tokens.length ) return ui.notifications.info(loc("Factions.RienSelectionne"));
      await assignFaction(tokens, b.dataset.assign);
      rerender();
    }));
    root.querySelector("[data-clear]")?.addEventListener("click", async () => {
      const tokens = selected();
      if ( !tokens.length ) return ui.notifications.info(loc("Factions.RienSelectionne"));
      await assignFaction(tokens, null);
      rerender();
    });
    root.querySelector("[data-action=add]")?.addEventListener("click", async () => {
      await addFaction({ name: loc("Factions.NouvelleFaction") });
      rerender();
    });
    root.querySelector("[data-action=suggest]")?.addEventListener("click", async () => { await applySuggested(); rerender(); });
    root.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: loc("Factions.Supprimer") },
        content: `<p>${esc(loc("Factions.SupprimerConfirmer", { name: b.closest("tr").querySelector("[name=name]").value || b.dataset.remove }))}</p>` });
      if ( ok ) { await removeFaction(b.dataset.remove); rerender(); }
    }));
    root.querySelector("[data-action=save]")?.addEventListener("click", async () => {
      const current = factionSettings();
      const split = v => String(v ?? "").split(/[,;]+/).map(s => s.trim()).filter(Boolean);
      const factions = current.factions.map(f => {
        const row = root.querySelector(`tr[data-edit="${CSS.escape(f.id)}"]`);
        if ( !row ) return f;
        const val = n => row.querySelector(`[name=${n}]`)?.value;
        return { ...f, name: val("name") ?? f.name, color: val("color") ?? f.color,
          rules: f.id === PARTY ? {} : { types: split(val("types")), subtypes: split(val("subtypes")), identifiers: split(val("identifiers")) } };
      });
      await saveFactions({ ...current, factions });
      ui.notifications.info(loc("Factions.Enregistre"));
      rerender();
    });
    // Glisser une pastille (vers un token de la scène) ; déposer un acteur sur une ligne ou sur « Aucune ».
    root.querySelectorAll("[data-drag-faction]").forEach(el => el.addEventListener("dragstart", ev => {
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, faction: el.dataset.dragFaction }));
    }));
    root.querySelectorAll("[data-faction]").forEach(zone => {
      zone.addEventListener("dragover", ev => { ev.preventDefault(); zone.classList.add("drop"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop"));
      zone.addEventListener("drop", async ev => {
        ev.preventDefault();
        zone.classList.remove("drop");
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
        const id = zone.dataset.faction === NONE ? null : zone.dataset.faction;
        if ( data?.type === "Actor" ) {
          const actor = await fromUuid(data.uuid);
          if ( actor?.documentName === "Actor" ) await assignFaction([actor], id);
        } else if ( data?.type === "Folder" ) {
          const folder = await fromUuid(data.uuid);
          if ( folder?.type === "Actor" ) await assignFaction(folder.contents, id);
        }
        rerender();
      });
    });
  }

  _onClose(options) {
    super._onClose?.(options);
    if ( open === this ) open = null;
  }
};

/** Ouvrir (ou ramener devant) la fenêtre. */
export function openFactions() {
  open ??= new (FactionsApp())();
  return open.render({ force: true });
}

/** Une pastille déposée sur la scène : le token sous le curseur rejoint la faction. */
function onDropCanvas(canvasRef, data) {
  if ( (data?.type !== DRAG_TYPE) || !game.user.isGM ) return;
  const token = canvas.tokens.placeables.filter(t => t.visible && t.bounds.contains(data.x, data.y))
    .sort((a, b) => b.document.sort - a.document.sort)[0];
  if ( !token ) return false;
  assignFaction([token.document], data.faction).then(() => open?.render());
  return false;
}

/** Le HUD du token (MJ) : un bouton à la couleur de sa faction, qui ouvre la liste. */
function onTokenHUD(hud, html) {
  if ( !game.user.isGM ) return;
  const token = hud.document;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  if ( !token || !column ) return;
  const { factions } = factionSettings();
  const current = factions.find(f => f.id === factionOf(token)) ?? null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon das-faction-hud";
  if ( current ) button.style.setProperty("--faction", current.color);
  button.dataset.tooltip = current ? loc("Factions.HUD", { name: factionName(current) }) : loc("Factions.HUDAucune");
  button.innerHTML = `<i class="fa-solid fa-flag"></i>`;
  button.addEventListener("click", async ev => {
    ev.preventDefault(); ev.stopPropagation();
    const own = token.getFlag(MODULE_ID, "faction") ?? "";
    const options = [`<option value="">${esc(loc("Factions.ParDefaut"))}</option>`, `<option value="${NONE}" ${own === NONE ? "selected" : ""}>${esc(loc("Factions.Aucune"))}</option>`,
      ...factions.map(f => `<option value="${esc(f.id)}" ${own === f.id ? "selected" : ""}>${esc(factionName(f))}</option>`)].join("");
    const inherited = explicitFaction(token) && !own ? `<p class="das-muted">${esc(loc("Factions.DeLActeur"))}</p>` : "";
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: loc("Factions.HUDTitre", { name: token.name }) },
      content: `<div class="form-group"><label>${esc(loc("Factions.Choix"))}</label><select name="faction">${options}</select></div>${inherited}
        <label class="checkbox"><input type="checkbox" name="actor"> ${esc(loc("Factions.PourActeur"))}</label>`,
      ok: { label: "OK", callback: (event, b) => ({ faction: b.form.elements.faction.value, actor: b.form.elements.actor.checked }) },
      rejectClose: false
    });
    if ( !value ) return;
    const target = (value.actor && token.baseActor) ? token.baseActor : token;
    await assignFaction([target], value.faction || null);
    hud.render();
    open?.render();
  });
  column.append(button);
}

export function registerFactionsUI() {
  if ( game.settings.registerMenu ) game.settings.registerMenu(MODULE_ID, "factionsMenu", {
    name: "DND5ECOMBAT.Factions.Menu.Nom", label: "DND5ECOMBAT.Factions.Menu.Bouton", hint: "DND5ECOMBAT.Factions.Menu.Aide",
    icon: "fa-solid fa-flag", type: FactionsApp(), restricted: true
  });
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-factions"] = { name: "das-factions", order: last + 1, icon: "fa-solid fa-flag", title: "DND5ECOMBAT.Factions.Titre",
      button: true, visible: true, onChange: () => openFactions() };
  }, { label: "factions: tool" });
  route("renderTokenHUD", onTokenHUD, { label: "factions: token HUD" });
  route("dropCanvasData", onDropCanvas, { label: "factions: token drop", cancellable: true });
  route(`${MODULE_ID}.factionsChanged`, () => open?.render(), { label: "factions: window refresh" });
}

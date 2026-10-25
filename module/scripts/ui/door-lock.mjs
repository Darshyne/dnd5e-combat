/**
 * §244 : la section « DAS · Serrure » de la configuration d'un mur (MJ seulement), sous les réglages de porte du cœur. Ses champs
 * s'écrivent dans le drapeau `flags.dnd5e-combat.lock` du mur, avec le reste du formulaire (WallConfig, templates/scene/wall-config.hbs).
 * Elle ne se montre que pour une porte, et suit le choix « Type de porte » du formulaire (`door`, wall-config.mjs `_onChangeForm`).
 */

import { MODULE_ID } from "../constants.mjs";
import { LOCK_DC_PRESETS } from "../core/locks.mjs";
import { LOCK_FLAG, lockOf } from "../adapter/locks.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const CLASS = "dnd5e-combat-door-lock";

function onRenderWallConfig(app, html) {
  if ( !game.user.isGM ) return;
  const root = (html instanceof HTMLElement) ? html : app.element;
  const doc = app.document;
  if ( !root || !doc || root.querySelector(`.${CLASS}`) ) return;
  const lock = lockOf(doc);
  const name = key => `flags.${MODULE_ID}.${LOCK_FLAG}.${key}`;
  const listId = `${app.id}-${CLASS}-dc`;
  const options = LOCK_DC_PRESETS.map(dc => `<option value="${dc}">${esc(loc(`Serrure.Config.Repere${dc}`))}</option>`).join("");
  const field = (label, input) => `<div class="form-group"><label>${esc(loc(label))}</label><div class="form-fields">${input}</div></div>`;
  const number = (key, value) => `<input type="number" min="1" max="40" step="1" name="${name(key)}" value="${value ?? ""}" list="${listId}" placeholder="${esc(loc("Serrure.Config.MJ"))}">`;
  const fieldset = document.createElement("fieldset");
  fieldset.className = CLASS;
  fieldset.innerHTML = `
    <legend>${esc(loc("Serrure.Config.Titre"))}</legend>
    <p class="hint">${esc(loc("Serrure.Config.Aide"))}</p>
    <datalist id="${listId}">${options}</datalist>
    ${field("Serrure.Config.DDCrocheter", number("pickDc", lock.pickDc))}
    ${field("Serrure.Config.DDForcer", number("forceDc", lock.forceDc))}
    ${field("Serrure.Config.NonForcable", `<input type="checkbox" name="${name("unforceable")}" ${lock.unforceable ? "checked" : ""}>`)}
    ${field("Serrure.Config.Cle", `<input type="text" name="${name("key")}" value="${esc(lock.key)}" placeholder="${esc(loc("Serrure.Config.CleExemple"))}">`)}`;
  fieldset.hidden = !(doc.door > CONST.WALL_DOOR_TYPES.NONE);
  const footer = root.querySelector(".form-footer");
  if ( footer ) footer.before(fieldset);
  else root.append(fieldset);
  root.querySelector("[name=door]")?.addEventListener("change", event => {
    fieldset.hidden = !(Number(event.target.value) > CONST.WALL_DOOR_TYPES.NONE);
    app.setPosition?.({ height: "auto" });
  });
  app.setPosition?.({ height: "auto" });
}

export function registerDoorLockUi() {
  route("renderWallConfig", onRenderWallConfig, { label: "door lock: wall configuration section" });
}

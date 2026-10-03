/**
 * Indicateur de lumière (SPEC §16.50, §40.2) : dans quelle lumière se tient un token, telle que les autres la voient
 * (core/illumination.mjs, `lightIndicator`), ce que ça change (vu, Désavantage pour le voir, peut se cacher) et comment
 * lui-même y voit. Le moteur ne dessine rien : il publie le calcul (`api.light`, `api.ui.light`) et l'infobulle, qu'une
 * interface affiche où elle veut (le témoin de la Barre de Darsh UI DnD5). Le réglage client « Indicateur de lumière » est
 * rendu dans `enabled` : à l'interface de le respecter.
 */

import { MODULE_ID } from "../constants.mjs";
import { LIGHT, lightIndicator, perceivedLight } from "../core/illumination.mjs";
import { lightOnToken, sensesToward, tokenPoint, globalLight } from "../adapter/illumination.mjs";
import { loc } from "../runtime/shared.mjs";

const SETTING = "lightIndicator";
const ICONS = { bright: "fa-sun", dim: "fa-circle-half-stroke", dark: "fa-moon", magical: "fa-moon" };

function tooltip({ key, own }) {
  const lines = [`<strong>${loc(`Lumiere.${key}.Nom`)}</strong>`, loc(`Lumiere.${key}.Texte`)];
  if ( own ) lines.push(`<em>${loc("Lumiere.Vous", { level: loc(`Lumiere.${own}.Bas`) })}</em>`);
  return lines.join("<br>");
}

/**
 * La lumière où se tient un token, pour une interface (`api.light`, demandée par Darsh UI DnD5 le 2026-09-27).
 * @param {Token|TokenDocument} token
 * @returns {{key: "bright"|"dim"|"dark"|"magical", icon: string, name: string, tooltip: string, enabled: boolean}|null}
 *   `enabled` : le réglage client « Indicateur de lumière » ; null sans canevas ou sans token sur une scène.
 */
export function lightState(token) {
  const doc = token?.document ?? token;
  if ( !doc?.parent || !canvas?.ready ) return null;
  const light = lightOnToken(doc);
  if ( !light ) return null;
  const own = perceivedLight(light, sensesToward(doc, tokenPoint(doc)));
  const state = lightIndicator(light, own);
  return { key: state.key, icon: ICONS[state.key], name: loc(`Lumiere.${state.key}.Nom`), tooltip: tooltip(state),
    enabled: game.settings.get(MODULE_ID, SETTING) };
}

/**
 * Ce que donne la lumière globale de la scène affichée, selon les règles du moteur (§16.52 : plage d'obscurité, « vive »,
 * crépuscule) — pour un module d'affichage qui veut le même « plein jour » que les règles (`api.ui.globalLight`, §40.2).
 * @returns {"bright"|"dim"|null}  null : pas de lumière globale à cette obscurité, ou pas de canevas.
 */
export function globalLightState() {
  const level = globalLight();
  return (level === LIGHT.BRIGHT) ? "bright" : (level === LIGHT.DIM) ? "dim" : null;
}

export function registerLightIndicator() {
  game.settings.register(MODULE_ID, SETTING, { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.lightIndicator.Nom", hint: "DND5ECOMBAT.Reglage.lightIndicator.Aide" });
}

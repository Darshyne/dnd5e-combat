/**
 * La chance de toucher près du curseur, façon BG3 (SPEC §15.3). `ui/pointer.mjs` décide quand
 * l'afficher (survol d'une cible avec l'attaque de base en combat, ou en mode visée) ; ici on ne
 * fait que la dessiner. Le calcul est dans adapter/hitchance.mjs, la formule dans core/hitchance.mjs.
 *
 * Ce que voit un joueur est un réglage de monde : pourcentage et CA (comme BG3), pourcentage seul,
 * ou rien. Le MJ voit toujours tout.
 */

import { MODULE_ID } from "../constants.mjs";
import { asPercent } from "../core/hitchance.mjs";
import { hitChanceOf, saveChanceOf } from "../adapter/hitchance.mjs";
import { loc } from "../runtime/shared.mjs";
import { describeReason } from "./chat.mjs";

const OFFSET = 18;
let badge = null;

function element() {
  if ( badge ) return badge;
  badge = document.createElement("div");
  badge.classList.add("dnd5e-combat-hitchance");
  badge.hidden = true;
  document.body.append(badge);
  return badge;
}

/** Ce que ce client a le droit de voir : "full", "percent" ou "off". */
function reveal() {
  if ( !game.settings.get(MODULE_ID, "hitChance") ) return "off";
  return game.user.isGM ? "full" : game.settings.get(MODULE_ID, "hitChancePlayers");
}

function line(css, text) {
  const p = document.createElement("div");
  p.classList.add(css);
  p.textContent = text;
  return p;
}

function coverText(cover) {
  if ( !cover ) return null;
  return (cover.bonus === null) ? loc("AbriTotal") : `${loc(`Abri.${cover.degree}`)} (+${cover.bonus})`;
}

/** Suit le curseur (à chaque mouvement, sans attendre le calcul, qui est bridé). */
export function placeHitChance(event) {
  if ( !badge || badge.hidden ) return;
  const { offsetWidth: w, offsetHeight: h } = badge;
  badge.style.left = `${Math.min(event.clientX + OFFSET, window.innerWidth - w - 4)}px`;
  badge.style.top = `${Math.min(event.clientY + OFFSET, window.innerHeight - h - 4)}px`;
}

/** Un badge au curseur, sans chance de toucher : « Hors de portée », « Déjà visé » (§16.29). */
export function showBadge(event, text) {
  if ( reveal() === "off" ) return hideHitChance();
  const el = element();
  el.replaceChildren();
  el.classList.remove("good", "fair");
  el.classList.add("poor");
  el.append(line("percent", text));
  el.hidden = false;
  placeHitChance(event);
}

export function hideHitChance() {
  if ( badge ) badge.hidden = true;
}

/**
 * Affiche la chance qu'`attacker` touche `target` avec `activity`.
 * @param {PointerEvent} event
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {object} [options.posA]         Position de l'attaquant au bout de son approche.
 * @param {boolean} [options.outOfReach]  L'approche n'arrive pas à portée ce tour-ci.
 * @param {{advantage?: boolean, disadvantage?: boolean}} [options.keys]  Touches d'avantage / désavantage tenues.
 */
export function showHitChance(event, attacker, target, activity, { posA, outOfReach=false, keys={} }={}) {
  const level = reveal();
  if ( (level === "off") || (activity?.type !== "attack") ) return hideHitChance();
  let info = null;
  if ( !outOfReach ) {
    try { info = hitChanceOf(attacker, target, activity, { posA, keys }); }
    catch(err) { console.warn(`${MODULE_ID} | chance de toucher`, err); }
    if ( !info ) return hideHitChance();
  }

  const el = element();
  el.replaceChildren();
  el.classList.remove("good", "fair", "poor");
  if ( outOfReach ) {
    el.classList.add("poor");
    el.append(line("percent", loc("Toucher.HorsDatteinte")));
  }
  else {
    const percent = asPercent(info.hit);
    el.classList.add(percent >= 60 ? "good" : percent >= 35 ? "fair" : "poor");
    el.append(line("percent", `${percent} %`));
    const crit = (info.critical > 0) && (info.critical < 0.005) ? "< 1" : asPercent(info.critical);
    if ( info.hit > 0 ) el.append(line("detail", loc("Toucher.Critique", { percent: crit })));
    // CA et abri : la CA seulement si le MJ la révèle aux joueurs.
    if ( info.ac === null ) el.append(line("detail", coverText(info.cover)));
    else if ( level === "full" ) el.append(line("detail", `${loc("Toucher.CA")} ${info.ac}${info.cover ? ` — ${coverText(info.cover)}` : ""}`));
    else if ( info.cover ) el.append(line("detail", coverText(info.cover)));
    const advantage = info.advantage.map(describeReason);
    const disadvantage = info.disadvantage.map(describeReason);
    if ( info.system.advantage ) advantage.push(loc("Toucher.Fiche"));
    if ( info.system.disadvantage ) disadvantage.push(loc("Toucher.Fiche"));
    if ( info.keys.advantage ) advantage.push(loc("Toucher.Touche"));
    if ( info.keys.disadvantage ) disadvantage.push(loc("Toucher.Touche"));
    if ( advantage.length ) el.append(line("advantage", `${loc("Avantage")} : ${advantage.join(", ")}`));
    if ( disadvantage.length ) el.append(line("disadvantage", `${loc("Desavantage")} : ${disadvantage.join(", ")}`));
    if ( advantage.length && disadvantage.length ) el.append(line("detail", loc("Toucher.SAnnulent")));
  }
  el.hidden = false;
  placeHitChance(event);
}

/**
 * Affiche la chance que `target` rate la sauvegarde de `activity` (§15.3) : le pourcentage d'échec, du point de vue du
 * lanceur ; le DD et le bonus de la cible si le MJ les révèle (réglage « pourcentage et CA ») ; avantage, désavantage,
 * échec d'office, immunité, Résistance légendaire.
 */
export function showSaveChance(event, caster, target, activity, { outOfReach=false }={}) {
  const level = reveal();
  if ( (level === "off") || (activity?.type !== "save") ) return hideHitChance();
  let info = null;
  if ( !outOfReach ) {
    try { info = saveChanceOf(caster, target, activity); }
    catch(err) { console.warn(`${MODULE_ID} | chance d'échec de la sauvegarde`, err); }
    if ( !info ) return hideHitChance();
  }
  const el = element();
  el.replaceChildren();
  el.classList.remove("good", "fair", "poor");
  if ( outOfReach ) {
    el.classList.add("poor");
    el.append(line("percent", loc("Toucher.HorsDatteinte")));
  }
  else {
    const percent = asPercent(info.fail);
    el.classList.add(percent >= 60 ? "good" : percent >= 35 ? "fair" : "poor");
    el.append(line("percent", loc("Sauvegarde.Echec", { percent })));
    const ability = game.i18n.localize(CONFIG.DND5E.abilities[info.ability]?.label ?? info.ability);
    const sign = n => (n >= 0 ? `+${n}` : `${n}`);
    const dice = info.dice.map(d => `${d.sign < 0 ? "-" : "+"}${d.number}d${d.faces}`).join("");
    if ( level === "full" ) el.append(line("detail", loc("Sauvegarde.DD", { dc: info.dc, ability, bonus: `${sign(info.bonus)}${dice}` })));
    else el.append(line("detail", ability));
    if ( info.immune ) el.append(line("detail", loc("Sauvegarde.Immunise")));
    if ( info.autoFail ) el.append(line("disadvantage", loc("Sauvegarde.AutoEchec",
      { status: game.i18n.localize(CONFIG.DND5E.conditionTypes[info.autoFail]?.name ?? info.autoFail) })));
    const reason = key => loc(`Sauvegarde.Raison.${key}`);
    if ( info.advantage.length ) el.append(line("advantage", `${loc("Avantage")} : ${info.advantage.map(reason).join(", ")}`));
    if ( info.disadvantage.length ) el.append(line("disadvantage", `${loc("Desavantage")} : ${info.disadvantage.map(reason).join(", ")}`));
    if ( info.advantage.length && info.disadvantage.length ) el.append(line("detail", loc("Toucher.SAnnulent")));
    if ( (info.legendary > 0) && (level === "full") ) el.append(line("detail", loc("Sauvegarde.Legendaire", { n: info.legendary })));
  }
  el.hidden = false;
  placeHitChance(event);
}

export function registerHitChance() {
  game.settings.register(MODULE_ID, "hitChance", { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.hitChance.Nom", hint: "DND5ECOMBAT.Reglage.hitChance.Aide" });
  game.settings.register(MODULE_ID, "hitChancePlayers", { scope: "world", config: true, type: String, default: "full",
    name: "DND5ECOMBAT.Reglage.hitChancePlayers.Nom", hint: "DND5ECOMBAT.Reglage.hitChancePlayers.Aide",
    choices: {
      full: "DND5ECOMBAT.Reglage.hitChancePlayers.full",
      percent: "DND5ECOMBAT.Reglage.hitChancePlayers.percent",
      off: "DND5ECOMBAT.Reglage.hitChancePlayers.off"
    } });
}

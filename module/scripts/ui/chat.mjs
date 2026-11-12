import { MODULE_ID } from "../constants.mjs";
import { critMargin } from "../adapter/criticals.mjs";
import { current, pendingChoice, STEPS } from "../core/action.mjs";
import { undo, CHAT_LIGHT_SETTING } from "../runtime/engine.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";
import { typesLabel } from "../adapter/eligibility.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { convertLength } from "../core/units.mjs";
import { keptAndDropped } from "../core/d20.mjs";

function block(lines) {
  const div = document.createElement("div");
  div.classList.add("dnd5e-combat-result");
  for ( const line of lines ) {
    const p = document.createElement("p");
    p.classList.add(line.css);
    fillLine(p, line);
    div.append(p);
  }
  return div;
}

/**
 * Le contenu d'une ligne : son `text`, ou ses morceaux `nodes` — une chaîne, ou `{ struck }` pour un nombre barré (le dé écarté
 * d'un Avantage ou d'un Désavantage, issue #47).
 */
export function fillLine(p, { text, nodes }) {
  if ( !nodes ) { p.textContent = text; return; }
  for ( const node of nodes ) {
    if ( typeof node === "string" ) { p.append(node); continue; }
    const s = document.createElement("s");
    s.textContent = node.struck;
    s.dataset.tooltip = loc("Compact.Ecarte");
    p.append(s);
  }
}

const statusName = id => game.i18n.localize(CONFIG.statusEffects[id]?.name ?? id);

/**
 * Une distance de règle (« à 5 ft ») dans l'unité de la scène, formatée par dnd5e : « 1,5 m » sur une scène métrique (SPEC §5.7 ;
 * le texte figé « 5 ft » restait en pieds sur une scène en mètres — retour de table, 2026-10-17).
 */
function sceneLength(feet) {
  const units = canvas?.scene?.grid?.units ?? "ft";
  try { return dnd5e.utils.formatLength(convertLength(feet, "ft", units, readUnitFactors()), units); }
  catch { return dnd5e.utils.formatLength(feet, "ft"); }   // unité de scène inconnue de dnd5e : la règle en pieds
}

/** Une source d'avantage ou de désavantage (core/conditions.mjs), en clair. */
export function describeReason(r) {
  if ( r.who === "situation" ) return game.i18n.format(`DND5ECOMBAT.Raison.${r.key}`, { distance: sceneLength(5), ally: r.ally ?? "" });
  if ( r.who === "content" ) return r.key;   // le nom de l'item qui le déclare (§16, B6)
  if ( r.key === "unseen" ) return loc(`Raison.unseen.${r.who}`);   // vision (P1) : pas un état
  return game.i18n.format(`DND5ECOMBAT.Raison.${r.who}`, { status: r.key === "proneFar" ? loc("Raison.proneFar") : statusName(r.key) });
}

/** « Avantage : cible À terre, attaquant Invisible » : les lignes, sous le jet d'attaque ou sur la carte unique (ui/compact.mjs). */
export function modifierLines(modifiers) {
  const describe = describeReason;
  const lines = [];
  if ( !modifiers.agreed ) lines.push({ css: "pending", text: loc("CiblesDivergentes") });
  if ( modifiers.advantage?.length ) lines.push({ css: "hit", text: loc("LabelValue", { label: loc("Avantage"), value: modifiers.advantage.map(describe).join(", ") }) });
  if ( modifiers.disadvantage?.length ) lines.push({ css: "miss", text: loc("LabelValue", { label: loc("Desavantage"), value: modifiers.disadvantage.map(describe).join(", ") }) });
  if ( modifiers.advantage?.length && modifiers.disadvantage?.length ) lines.push({ css: "pending", text: loc("SAnnulent") });
  return lines;
}

/**
 * Issue #47 : « Désavantage : 11, 13 », le 13 barré — le dé gardé puis le dé écarté. La ligne de jet de dnd5e, comme la carte unique,
 * ne montrait que le dé gardé : un Désavantage se lisait comme un jet normal, ou le total et le dé comme deux dés. Rend les morceaux
 * d'une ligne (`fillLine`), ou null pour un jet à un seul d20.
 */
export function d20Nodes(roll) {
  const dice = keptAndDropped(roll?.dice?.[0]?.results, roll?.options?.advantageMode);
  if ( !dice ) return null;
  const nodes = [loc("LabelValue", { label: loc(dice.mode === 1 ? "Avantage" : "Desavantage"), value: dice.kept.join(", ") })];
  for ( const d of dice.dropped ) nodes.push(", ", { struck: String(d) });
  return nodes;
}

/** Sous le jet d'attaque déplié (ou sans carte unique) : les deux d20 d'un Avantage ou d'un Désavantage. */
function renderD20(message, html) {
  const nodes = (message.type === "attack") ? d20Nodes(message.rolls?.[0]) : null;
  if ( nodes ) html.querySelector(".message-content")?.append(block([{ css: "note", nodes }]));
}

function renderModifiers(html, modifiers) {
  const lines = modifierLines(modifiers);
  if ( lines.length ) html.querySelector(".message-content")?.append(block(lines));
}

/** « Maléfice : +1d6 nécrotique » : les lignes, sous le jet de dégâts ou sur la carte unique. */
export function bonusLines(bonuses) {
  const typeName = t => game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t);
  // §161 : plusieurs types au choix (Invocation d'élémentaires mineurs).
  return bonuses.map(b => ({ css: "note", text: loc("DegatsBonus", { name: b.name, formula: b.formula, type: [b.damageType].flat().map(typeName).join(" / ") }) }));
}

/**
 * §408 : la carte d'une action dont une règle a été passée outre — un bandeau « Règle passée outre » en tête, les raisons en infobulle et
 * en dessous, visible de toute la table (règle de l'utilisateur : le joueur décide, la table est prévenue).
 */
function renderOverridden(html, reasons) {
  const content = html.querySelector(".message-content");
  if ( !content || content.querySelector(".das-overridden") ) return;
  const div = document.createElement("div");
  div.className = "das-overridden";
  div.dataset.tooltip = reasons.join("<br>");
  const title = document.createElement("strong");
  title.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ';
  title.append(loc("Force.Carte"));
  const list = document.createElement("ul");
  for ( const reason of reasons ) {
    const li = document.createElement("li");
    li.textContent = reason;
    list.append(li);
  }
  div.append(title, list);
  content.prepend(div);
}

function renderBonuses(html, bonuses) {
  html.querySelector(".message-content")?.append(block(bonusLines(bonuses)));
}

/** « Non affecté : un humanoïde seulement », « non affecté : immunité (Charmé) », « non affecté ». */
function unaffectedText({ reason, detail }) {
  if ( reason === "type" ) return loc("NonAffecte.type", { types: typesLabel((detail ?? "").split(",").filter(Boolean)) });
  if ( reason === "immune" ) return loc("NonAffecte.immune", { status: statusName(detail) });
  if ( reason === "globe" ) return loc("NonAffecte.globe", { item: detail ?? "" });
  if ( reason === "plane" ) return loc("NonAffecte.plane");
  if ( reason === "enclosed" ) return loc("NonAffecte.enclosed", { item: detail ?? "" });
  return loc("NonAffecte.content");
}

/** Le verdict d'une cible, en clair. La CA n'est jamais affichée. */
function verdictText(t) {
  const key = t.critical ? "Critique" : t.hit ? "Touche" : (t.reason === "cover" ? "AbriTotal" : "Rate");
  const notes = [];
  if ( t.reaction ) notes.push(t.reaction);
  if ( t.reason === "duplicate" ) notes.push(loc("Repliques.Note"));
  else if ( t.reason === "autoCritical" ) notes.push(loc("CritiqueDOffice"));
  else if ( t.reason === "beatsAc" ) notes.push(loc("CritOption.Ecart", { margin: critMargin() }));   // §207
  else if ( t.reason === "atCost" ) notes.push(loc("APrix.Note"));   // issue #32 : succès à un prix
  // P1 (b) : l'abri calculé par le moteur, sans la CA.
  if ( t.cover && (t.cover.bonus !== null) ) notes.push(`${loc(`Abri.${t.cover.degree}`)} +${t.cover.bonus}`);
  return `${loc(key)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/** Toucher / raté par cible sous le jet d'attaque, visible de tous, quand le porteur est un autre message. */
function renderVerdict(html, resolution) {
  if ( !resolution.attack || [STEPS.AWAITING_ATTACK, STEPS.AWAITING_REACTION].includes(resolution.step) ) return;
  const lines = resolution.targets.map(t => ({ css: t.hit ? "hit" : "miss", text: `${t.name} — ${verdictText(t)}` }));
  html.querySelector(".message-content")?.append(block(lines));
}

/** Note « annulé », ou bouton d'annulation pour le MJ. */
function appendUndo(div, message, undone) {
  if ( undone ) {
    const p = document.createElement("p");
    p.classList.add("note");
    p.textContent = loc("Annule");
    div.append(p);
  } else if ( game.user.isGM ) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = loc("Annuler");
    button.addEventListener("click", () => undo(message));
    div.append(button);
  }
}

/** Dégâts réellement perdus par cible, et bouton d'annulation pour le MJ. */
function renderDamage(message, html, applied) {
  const lines = applied.lines.map(l => ({
    css: applied.undone ? "undone" : "hit",
    text: `${l.name} — ${lostOrHealed(l.applied)}`
  }));
  const div = block(lines);
  appendUndo(div, message, applied.undone);
  html.querySelector(".message-content")?.append(div);
}

const lostOrHealed = applied => (applied < 0) ? loc("PvRendus", { n: -applied }) : loc("PvPerdus", { n: applied });

/**
 * L'action entière sur son porteur : une ligne par cible — verdict, sauvegarde, PV, effets — en
 * attente puis tranchée. Ni la CA ni le DD ne sont affichés. Tant qu'une réaction peut encore
 * changer le verdict, il n'est pas montré.
 */
function renderResolution(message, html, resolution) {
  const { plan, step } = resolution;
  if ( step === STEPS.AWAITING_ATTACK ) return;
  const content = html.querySelector(".message-content");
  if ( !content ) return console.warn(`${MODULE_ID} | card without .message-content, resolution not shown`, html);
  if ( step === STEPS.AWAITING_REACTION ) return content.append(block([{ css: "pending", text: loc("ReactionEnAttente") }]));
  if ( pendingChoice(resolution) ) return content.append(block([{ css: "pending", text: loc("ChoixEnAttente") }]));

  const undone = step === STEPS.UNDONE;
  const lines = resolution.targets.map(t => {
    // §16.8 : hors d'atteinte de l'action (type de créature, règle du contenu, immunité) — rien d'autre à dire.
    if ( t.unaffected ) return { css: undone ? "undone" : "miss", text: `${t.name} — ${unaffectedText(t.unaffected)}` };
    const parts = [];
    let css = "hit";
    if ( plan.attack ) { parts.push(verdictText(t)); if ( !t.hit ) css = "miss"; }
    const reached = !plan.attack || t.hit;
    if ( plan.save && reached ) {
      if ( !t.save ) { parts.push(loc("SauvegardeAttendue")); css = "pending"; }
      else {
        // §232 : `willing` — une créature consentante (Sphère résiliente d'Otiluke).
        parts.push((t.save.auto === "noSave") ? loc("SansSauvegarde") : (t.save.auto === "willing") ? loc("Consentant.Carte")
          : t.save.auto ? loc("SauvegardeDOffice", { status: statusName(t.save.auto) })
          : loc(t.save.success ? "SauvegardeReussie" : "SauvegardeRatee", { n: t.save.total }));
        if ( t.save.atCost ) parts.push(loc("APrix.Note"));   // issue #32 : succès à un prix
        if ( t.save.success && !plan.attack ) css = "miss";
      }
    }
    if ( t.damage ) parts.push(lostOrHealed(t.damage.applied));
    if ( t.effects?.length ) parts.push(loc("EffetsAppliques", { n: t.effects.length }));
    return { css: undone ? "undone" : css, text: `${t.name} — ${parts.join(", ")}` };
  });
  const div = block(lines);
  if ( (step === STEPS.DONE) || undone ) appendUndo(div, message, undone);
  content.append(div);
}

/** Journal allégé : les cartes hors écran ne sont ni mises en page ni dessinées (content-visibility, styles/dnd5e-combat.css). */
function applyChatLight() {
  document.body.classList.toggle("dnd5e-combat-chat-light", !!game.settings.get(MODULE_ID, CHAT_LIGHT_SETTING));
}

export function registerChat() {
  route("ready", applyChatLight, { label: "light chat log" });
  route("updateSetting", setting => { if ( setting.key === `${MODULE_ID}.${CHAT_LIGHT_SETTING}` ) applyChatLight(); },
    { label: "light chat log: setting changed" });
  // Pas `renderChatMessageHTML` : le cœur l'émet AVANT que dnd5e ne remplace le contenu de
  // `.message-content` par sa propre carte (chat-message-data-model.mjs:80-82), ce qui effaçait
  // notre bloc. `dnd5e.renderChatMessage` est émis après (documents/chat-message.mjs:168).
  route("dnd5e.renderChatMessage", (message, html) => {
    const overridden = message.getFlag(MODULE_ID, "overridden");
    if ( overridden?.length ) renderOverridden(html, overridden);
    if ( message.isContentVisible !== false ) renderD20(message, html);   // un jet secret garde ses dés
    const modifiers = message.getFlag(MODULE_ID, "modifiers");
    if ( modifiers ) renderModifiers(html, modifiers);
    const bonuses = message.getFlag(MODULE_ID, "bonuses");
    if ( bonuses?.length ) renderBonuses(html, bonuses);
    // Une résolution d'un ancien schéma (avant la 0.9.0) n'est plus affichée.
    const resolution = current(message.getFlag(MODULE_ID, "resolution"));
    if ( resolution ) renderResolution(message, html, resolution);
    const verdict = message.getFlag(MODULE_ID, "verdict");
    const judged = verdict ? current(game.messages.get(verdict.carrier)?.getFlag(MODULE_ID, "resolution")) : null;
    if ( judged ) renderVerdict(html, judged);
    const applied = message.getFlag(MODULE_ID, "applied");
    if ( applied ) renderDamage(message, html, applied);
  }, { label: "verdict on the chat card" });
}

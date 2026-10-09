import { MODULE_ID } from "../constants.mjs";
import { current, pendingChoice, STEPS } from "../core/action.mjs";
import { undo, CHAT_LIGHT_SETTING } from "../runtime/engine.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";
import { typesLabel } from "../adapter/eligibility.mjs";

function block(lines) {
  const div = document.createElement("div");
  div.classList.add("dnd5e-combat-result");
  for ( const { css, text } of lines ) {
    const p = document.createElement("p");
    p.classList.add(css);
    p.textContent = text;
    div.append(p);
  }
  return div;
}

const statusName = id => game.i18n.localize(CONFIG.statusEffects[id]?.name ?? id);

/** Une source d'avantage ou de désavantage (core/conditions.mjs), en clair. */
export function describeReason(r) {
  if ( r.who === "situation" ) return loc(`Raison.${r.key}`);
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

function renderModifiers(html, modifiers) {
  const lines = modifierLines(modifiers);
  if ( lines.length ) html.querySelector(".message-content")?.append(block(lines));
}

/** « Maléfice : +1d6 nécrotique » : les lignes, sous le jet de dégâts ou sur la carte unique. */
export function bonusLines(bonuses) {
  const typeName = t => game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t);
  return bonuses.map(b => ({ css: "note", text: loc("DegatsBonus", { name: b.name, formula: b.formula, type: typeName(b.damageType) }) }));
}

function renderBonuses(html, bonuses) {
  html.querySelector(".message-content")?.append(block(bonusLines(bonuses)));
}

/** « Non affecté : un humanoïde seulement », « non affecté : immunité (Charmé) », « non affecté ». */
function unaffectedText({ reason, detail }) {
  if ( reason === "type" ) return loc("NonAffecte.type", { types: typesLabel((detail ?? "").split(",").filter(Boolean)) });
  if ( reason === "immune" ) return loc("NonAffecte.immune", { status: statusName(detail) });
  return loc("NonAffecte.content");
}

/** Le verdict d'une cible, en clair. La CA n'est jamais affichée. */
function verdictText(t) {
  const key = t.critical ? "Critique" : t.hit ? "Touche" : (t.reason === "cover" ? "AbriTotal" : "Rate");
  const notes = [];
  if ( t.reaction ) notes.push(t.reaction);
  if ( t.reason === "duplicate" ) notes.push(loc("Repliques.Note"));
  else if ( t.reason === "autoCritical" ) notes.push(loc("CritiqueDOffice"));
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
        parts.push(t.save.auto ? loc("SauvegardeDOffice", { status: statusName(t.save.auto) })
          : loc(t.save.success ? "SauvegardeReussie" : "SauvegardeRatee", { n: t.save.total }));
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

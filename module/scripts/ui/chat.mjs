import { MODULE_ID } from "../constants.mjs";
import { critMargin } from "../adapter/criticals.mjs";
import { current, pendingChoice, settled, STEPS } from "../core/action.mjs";
import { undo, CHAT_LIGHT_SETTING } from "../runtime/engine.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";
import { overriddenShownOn } from "../runtime/forced.mjs";
import { typesLabel } from "../adapter/eligibility.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { convertLength } from "../core/units.mjs";
import { keptAndDropped } from "../core/d20.mjs";
import { manualModeOverride } from "../core/conditions.mjs";

/**
 * Réglage de monde (éteint par défaut : au MJ de l'activer) : une rangée par cible — icône du verdict, portrait, nom, détail —,
 * comme la carte de Midi-QOL.
 */
export const CHAT_ROWS_SETTING = "chatRows";

export const rowsEnabled = () => { try { return !!game.settings.get(MODULE_ID, CHAT_ROWS_SETTING); } catch { return false; } };

/** L'icône du verdict d'une rangée, par classe de ligne (celles de Midi-QOL : coche, coche double au critique, croix). */
const ROW_ICONS = Object.freeze({ hit: "fa-check", critical: "fa-check-double", miss: "fa-xmark", pending: "fa-hourglass-half",
  undone: "fa-rotate-left" });

/** L'image du token d'une cible, ou null (token parti, ancienne carte sans uuid). */
function tokenImage(uuid) {
  const token = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return token?.texture?.src ?? token?.actor?.img ?? null;
}

/**
 * Les lignes d'un résultat en rangées, dans le balisage de la carte de Midi-QOL (ses gabarits `hits.html` et `saves.html`, MIT —
 * la notice est dans styles/dnd5e-combat.css) :
 * une liste de cibles de dnd5e (`ul.evaluation` > `li.target.success|failure`) avec le symbole du verdict, le portrait du token
 * et le nom ; pour une attaque, la CA de la cible à droite (MJ seulement) ; pour une sauvegarde, un titre (caractéristique, et DD
 * si dnd5e le montre à ce joueur) et le total de chaque jet à droite, son détail au survol. Ce que le moteur a fait à la cible
 * (PV perdus, effets) est l'infobulle de sa rangée.
 */
function rows(lines, context={}) {
  const saves = lines.some(line => line.save) && !lines.some(line => line.attack);
  const results = document.createElement("div");
  results.classList.add("midi-results", "dnd5e-combat-rows");
  const section = document.createElement("div");
  section.classList.add(saves ? "midi-qol-saves-display" : "midi-qol-hits-display", "midi-qol-section-filled");
  const list = document.createElement("ul");
  list.classList.add("unlist", "evaluation", "wrapper");
  for ( const line of lines ) {
    const li = saves ? saveRow(line, context) : hitRow(line, context);
    // Comme Midi-QOL : survol, clic et clic droit sur la rangée agissent sur le token.
    li.addEventListener("mouseenter", hoverTarget);
    li.addEventListener("mouseleave", leaveTarget);
    li.addEventListener("click", selectTarget);
    li.addEventListener("contextmenu", showTarget);
    list.append(li);
  }
  if ( saves ) {
    const holder = document.createElement("div");
    if ( context.save ) holder.append(...saveHeadings(context, lines.length));
    holder.append(list);
    section.append(holder);
  } else {
    const card = document.createElement("div");
    card.classList.add("midi-qol-single-hit-card");
    const evaluation = document.createElement("div");
    evaluation.classList.add("evaluation");
    evaluation.append(list);
    card.append(evaluation);
    section.append(card);
  }
  results.append(section);
  return results;
}

/** Le DD est-il montré à cet utilisateur ? Au MJ, au propriétaire du lanceur, sinon selon le réglage de dnd5e. */
function challengeVisible(caster) {
  if ( game.user.isGM || caster?.testUserPermission?.(game.user, "OWNER") ) return true;
  let mode = "none";
  try { mode = game.settings.get("dnd5e", "challengeVisibility"); } catch { /* réglage absent */ }
  return (mode === "all") || ((mode === "player") && !!caster?.hasPlayerOwner);
}

/** Part des dégâts sur une sauvegarde réussie, telle que Midi-QOL la note sous le titre. */
const ON_SAVE_MARK = Object.freeze({ none: "0", half: "½", full: "1" });

/**
 * Les titres des sauvegardes, comme sur la carte de Midi-QOL : « DD 14 Jet de sauvegarde de Charisme » (au pluriel pour plusieurs
 * cibles, sans le DD pour qui ne doit pas le voir), puis, si l'action inflige des dégâts, leur part sur une réussite.
 */
function saveHeadings({ save, damage, caster }, count) {
  const heading = text => {
    const div = document.createElement("div");
    div.classList.add("midi-qol-save-heading");
    const strong = document.createElement("strong");
    strong.append(...text);
    div.append(strong);
    return div;
  };
  const ability = CONFIG.DND5E?.abilities?.[save.ability]?.label ?? save.ability ?? "";
  const title = [];
  if ( Number.isFinite(save.dc) && challengeVisible(caster) ) {
    const dc = document.createElement("label");
    dc.classList.add("midi-qol-saveDC");
    dc.textContent = `${game.i18n.localize("DND5E.AbbreviationDC")} ${save.dc}`;
    title.push(dc, " ");
  }
  title.push(loc((count > 1) ? "Rangees.Sauvegardes" : "Rangees.Sauvegarde", { ability }));
  const out = [heading(title)];
  if ( damage ) out.push(heading([`${game.i18n.localize("DND5E.Damage")} ${ON_SAVE_MARK[save.onSave ?? "half"] ?? "½"}`]));
  return out;
}

/** Le token d'une rangée, s'il est sur la scène affichée. */
function rowToken(event) {
  const uuid = event.currentTarget?.dataset?.uuid;
  const document = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return (document?.parent === canvas?.scene) ? document.object : null;
}

/** Survol d'une rangée : le token est mis en évidence, sauf s'il est déjà sélectionné. */
let highlighted = null;
function hoverTarget(event) {
  const token = rowToken(event);
  if ( !token?.isVisible ) return;
  if ( !token.controlled ) token._onHoverIn(event);
  highlighted = token;
}

function leaveTarget(event) {
  highlighted?._onHoverOut(event);
  highlighted = null;
}

/** Clic sur une rangée : le token est sélectionné (et la vue s'y porte) s'il est à l'utilisateur ; un second clic le relâche. */
function selectTarget(event) {
  event.stopPropagation();
  event.preventDefault();
  const token = rowToken(event);
  if ( token?.controlled ) token.release();
  else if ( token?.isVisible && token.actor?.testUserPermission(game.user, "OWNER") ) {
    token.control({ releaseOthers: false });
    canvas.animatePan(token.center);
  }
}

/** Clic droit sur une rangée : la fiche de l'acteur, pour son propriétaire. */
function showTarget(event) {
  event.stopImmediatePropagation();
  event.preventDefault();
  const token = rowToken(event);
  if ( token?.actor?.testUserPermission(game.user, "OWNER") ) token.actor.sheet?.render(true);
}

/** Le nom d'une cible. */
function stackedName(line) {
  const stacked = document.createElement("div");
  stacked.classList.add("name-stacked");
  const name = document.createElement("span");
  name.classList.add("midi-qol-target-name", "title");
  name.textContent = line.name;
  stacked.append(name);
  return stacked;
}

function symbol(name, ...classes) {
  const icon = document.createElement("i");
  icon.className = [...classes, "fas", name].filter(Boolean).join(" ");
  return icon;
}

function portrait(line, css) {
  const img = document.createElement("img");
  img.classList.add(css);
  img.src = tokenImage(line.token) ?? "icons/svg/mystery-man.svg";
  img.alt = "";
  return img;
}

/** La rangée d'une cible : ses classes, son token, et ce que le moteur lui a fait en infobulle. */
function targetRow(line, ...classes) {
  const li = document.createElement("li");
  li.classList.add("target", "midi-qol", "midi-qol-target-select", ...classes);
  if ( line.token ) { li.dataset.uuid = line.token; li.dataset.id = line.token.split(".").at(-1); }
  // `tooltipText` : du texte, jamais relu comme du HTML (un nom, le détail d'un jet).
  if ( line.detail ) { li.dataset.tooltipText = line.detail; li.dataset.tooltipDirection = "LEFT"; }
  return li;
}

/**
 * Une cible d'attaque : `li.target.success|failure` — coche, coche double au critique, croix — et sa CA pour le MJ. Une cible
 * sans verdict (soins, effet sans jet) n'a ni teinte ni symbole.
 */
function hitRow(line, { plain=false }={}) {
  const neutral = plain && (line.css === "hit");
  const outcome = neutral ? null : ({ hit: "success", miss: "failure" }[line.css] ?? `dnd5e-combat-${line.css}`);
  const li = targetRow(line, "midi-qol-hit-class", ...(outcome ? [outcome] : []));
  li.append(symbol(neutral ? "" : (ROW_ICONS[line.critical ? "critical" : line.css] ?? ROW_ICONS.hit), "midi-qol-hit-symbol"));
  li.append(portrait(line, "midi-qol-target-img"), stackedName(line));
  if ( game.user.isGM && line.attack && Number.isFinite(line.ac) ) {
    const ac = document.createElement("div");
    ac.classList.add("midi-qol-ac");
    const value = document.createElement("span");
    value.classList.add("midi-qol-ac-value");
    value.textContent = line.ac;
    const inner = document.createElement("span");
    inner.append(symbol("fa-shield-halved"), " ", value);
    ac.append(inner);
    li.append(ac);
  }
  return li;
}

/** Une cible de sauvegarde : `li.target.success|failure` (celle de la cible), le total de son jet à droite, détaillé au survol. */
function saveRow(line, { save=null, caster=null }={}) {
  const outcome = line.save ? (line.save.success ? "success" : "failure") : null;
  const li = targetRow(line, "midi-qol-save-class", outcome ?? `dnd5e-combat-${line.css}`);
  li.append(symbol(outcome ? (line.save.success ? "fa-check" : "fa-xmark") : (ROW_ICONS[line.css] ?? ROW_ICONS.pending),
    "midi-qol-save-symbol"));
  li.append(portrait(line, "midi-qol-save-img"));
  const name = document.createElement("div");
  name.classList.add("midi-qol-target-name", "midi-qol-save-name");
  name.append(stackedName(line));
  li.append(name);
  if ( Number.isFinite(line.save?.total) ) {
    const indicators = document.createElement("div");
    indicators.classList.add("midi-qol-save-indicators");
    const total = document.createElement("span");
    total.classList.add("midi-qol-tooltip", "midi-qol-save-total");
    total.append(String(line.save.total));
    const roll = game.messages.get(line.save.messageId)?.rolls?.[0];
    if ( roll ) {
      // Comme Midi-QOL : le calcul en infobulle (avec le DD pour qui le voit), le jet au survol.
      const versus = (Number.isFinite(save?.dc) && challengeVisible(caster))
        ? ` vs ${game.i18n.localize("DND5E.AbbreviationDC")} ${save.dc}` : "";
      total.dataset.tooltipText = `${line.save.total} = ${roll.result}${versus}`;
      total.append(saveTooltip(roll, line.save, outcome));
    }
    indicators.append(total);
    li.append(indicators);
  }
  return li;
}

/** Le jet de sauvegarde d'une cible, montré au survol de son total : formule, puis total teinté. */
function saveTooltip(roll, save, outcome) {
  const tip = document.createElement("span");
  tip.classList.add("midi-qol-tooltiptext", "midi-qol-save-tooltip");
  const block = document.createElement("div");
  block.classList.add("dice-roll");
  block.dataset.action = "expandRoll";
  const result = document.createElement("div");
  result.classList.add("dice-result");
  const formula = document.createElement("div");
  formula.classList.add("dice-formula");
  formula.textContent = roll.formula;
  const total = document.createElement("h4");
  total.classList.add("dice-total", outcome);
  const icons = document.createElement("div");
  icons.classList.add("icons");
  const icon = symbol(save.success ? "fa-check" : "fa-xmark");
  icon.inert = true;
  icons.append(icon);
  const value = document.createElement("span");
  value.classList.add("total");
  value.textContent = save.total;
  total.append(icons, value);
  const collapser = document.createElement("div");
  collapser.classList.add("dice-tooltip-collapser");
  result.append(formula, collapser, total);
  roll.getTooltip().then(html => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const tip = template.content.querySelector(".dice-tooltip");
    if ( tip ) collapser.replaceChildren(tip);
  }).catch(() => {});
  block.append(result);
  tip.append(block);
  return tip;
}

function block(lines, context={}) {
  const div = document.createElement("div");
  div.classList.add("dnd5e-combat-result");
  // En rangées, seulement un résultat par cible : les raisons d'avantage, les bonus et les attentes restent des lignes.
  if ( rowsEnabled() && lines.length && lines.every(line => line.name) ) { div.append(rows(lines, context)); return div; }
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

// Une raison d'office par type de créature (`type:plant`, core/conditions.mjs) se lit par le nom du type.
const statusName = id => String(id).startsWith("type:")
  ? game.i18n.localize(CONFIG.DND5E.creatureTypes[String(id).slice(5)]?.label ?? String(id).slice(5))
  : game.i18n.localize(CONFIG.statusEffects[id]?.name ?? id);

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

/**
 * « Avantage : cible À terre, attaquant Invisible » : les lignes, sous le jet d'attaque ou sur la carte unique (ui/compact.mjs). §480 : avec
 * le jet lancé (`roll`), une ligne de plus quand un Désavantage du moteur a été écarté à la main (`manualModeOverride`).
 */
export function modifierLines(modifiers, roll=null) {
  const describe = describeReason;
  const lines = [];
  if ( !modifiers.agreed ) lines.push({ css: "pending", text: loc("CiblesDivergentes") });
  if ( modifiers.advantage?.length ) lines.push({ css: "hit", text: loc("LabelValue", { label: loc("Avantage"), value: modifiers.advantage.map(describe).join(", ") }) });
  if ( modifiers.disadvantage?.length ) lines.push({ css: "miss", text: loc("LabelValue", { label: loc("Desavantage"), value: modifiers.disadvantage.map(describe).join(", ") }) });
  if ( modifiers.advantage?.length && modifiers.disadvantage?.length ) lines.push({ css: "pending", text: loc("SAnnulent") });
  const manual = roll ? manualModeOverride(modifiers, roll.options) : null;
  if ( manual ) lines.push({ css: "pending", text: loc(`ModeManuel.${manual}`) });
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

function renderModifiers(html, modifiers, roll=null) {
  const lines = modifierLines(modifiers, roll);
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
 * en dessous, visible de toute la table (règle de l'utilisateur : le joueur décide, la table est prévenue) — sauf réglage
 * `overrideVisibility` (issue #178) : alors le MJ et celui qui a forcé seulement.
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
  if ( reason === "antimagic" ) return loc("NonAffecte.antimagic", { item: detail ?? "" });
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
  const lines = resolution.targets.map(t => ({ css: t.hit ? "hit" : "miss", text: `${t.name} — ${verdictText(t)}`,
    name: t.name, token: t.token, detail: verdictText(t), critical: !!(t.hit && t.critical), attack: true, ac: t.ac }));
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
    text: `${l.name} — ${lostOrHealed(l.applied)}`,
    name: l.name, token: l.token ?? null, detail: lostOrHealed(l.applied)
  }));
  const div = block(lines);
  appendUndo(div, message, applied.undone);
  html.querySelector(".message-content")?.append(div);
}

const lostOrHealed = applied => (applied < 0) ? loc("PvRendus", { n: -applied }) : loc("PvPerdus", { n: applied });

/**
 * En rangées, une fois l'action réglée, la carte perd ce que la carte de Midi-QOL n'a plus à ce stade : les boutons de jet
 * d'attaque, de dégâts et de sauvegarde de dnd5e (les jets sont faits), la rangée du DD (il est dans le titre des sauvegardes),
 * les résumés de sauvegarde de dnd5e (les rangées les donnent) et le tiroir des effets que le moteur a déjà posés. Pas la carte
 * d'une action annulée (`settled`).
 */
function trimCard(content, plan) {
  const spent = ["rollAttack", "rollDamage", "rollSave"].map(action => `.chat-card button[data-action="${action}"]`).join(", ");
  for ( const button of content.querySelectorAll(spent) ) {
    const item = button.closest("li") ?? button;
    const row = item.closest("section.icon-row");
    item.remove();
    if ( row && !row.querySelector("button") ) row.remove();
  }
  if ( plan.save ) {
    content.querySelector(".chat-card section.icon-row:has(> i.fa-shield-heart)")?.remove();
    for ( const summary of content.querySelectorAll(":scope > .card-summary") ) summary.remove();
  }
  if ( plan.effects?.length ) content.querySelector(":scope > effect-application")?.remove();
}

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
  // Pas une carte annulée : le MJ peut vouloir relancer, elle garde les boutons de dnd5e et son tiroir d'effets.
  if ( rowsEnabled() && settled(step) ) trimCard(content, plan);

  const undone = step === STEPS.UNDONE;
  const lines = resolution.targets.map(t => {
    // §16.8 : hors d'atteinte de l'action (type de créature, règle du contenu, immunité) — rien d'autre à dire.
    if ( t.unaffected ) return { css: undone ? "undone" : "miss", text: `${t.name} — ${unaffectedText(t.unaffected)}`,
      name: t.name, token: t.token, detail: unaffectedText(t.unaffected) };
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
    // En rangées : le jet de sauvegarde de la cible (total, réussite) a sa place à droite ; une sauvegarde d'office n'en a pas.
    const rolled = (plan.save && reached && t.save && !t.save.auto)
      ? { total: t.save.total, success: !!t.save.success, messageId: t.save.messageId } : null;
    return { css: undone ? "undone" : css, text: `${t.name} — ${parts.join(", ")}`,
      name: t.name, token: t.token, detail: parts.join(", "), critical: !!(plan.attack && t.hit && t.critical),
      attack: !!plan.attack, ac: plan.attack ? t.ac : null, ...(rolled ? { save: rolled } : {}) };
  });
  const caster = message.speakerActor ?? ChatMessage.getSpeakerActor?.(message.speaker) ?? null;
  const div = block(lines, { save: plan.save, damage: !!plan.damage, plain: !plan.attack && !plan.save, caster });
  if ( (step === STEPS.DONE) || undone ) appendUndo(div, message, undone);
  content.append(div);
}

/** Journal allégé : les cartes hors écran ne sont ni mises en page ni dessinées (content-visibility, styles/dnd5e-combat.css). */
function applyChatLight() {
  document.body.classList.toggle("dnd5e-combat-chat-light", !!game.settings.get(MODULE_ID, CHAT_LIGHT_SETTING));
}

export function registerChat() {
  game.settings.register(MODULE_ID, CHAT_ROWS_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CHAT_ROWS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CHAT_ROWS_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => ui.chat?.render?.()
  });
  route("ready", applyChatLight, { label: "light chat log" });
  route("updateSetting", setting => { if ( setting.key === `${MODULE_ID}.${CHAT_LIGHT_SETTING}` ) applyChatLight(); },
    { label: "light chat log: setting changed" });
  // Pas `renderChatMessageHTML` : le cœur l'émet AVANT que dnd5e ne remplace le contenu de
  // `.message-content` par sa propre carte (chat-message-data-model.mjs:80-82), ce qui effaçait
  // notre bloc. `dnd5e.renderChatMessage` est émis après (documents/chat-message.mjs:168).
  route("dnd5e.renderChatMessage", (message, html) => {
    const overridden = message.getFlag(MODULE_ID, "overridden");
    if ( overridden?.length && overriddenShownOn(message) ) renderOverridden(html, overridden);   // issue #178
    if ( message.isContentVisible !== false ) renderD20(message, html);   // un jet secret garde ses dés
    const modifiers = message.getFlag(MODULE_ID, "modifiers");
    if ( modifiers ) renderModifiers(html, modifiers, (message.type === "attack") ? message.rolls?.[0] : null);
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

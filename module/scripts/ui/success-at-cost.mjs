/**
 * Issue #32 : « Succès à un prix », côté écran du MJ (runtime/success-at-cost.mjs décide).
 *  - **pastille** : pendant la pause d'un jet raté de 1 ou 2, une pastille dorée au-dessus du token du lanceur, chez le MJ seul —
 *    « Raté de 1 · Succès à un prix ? », l'anneau de la pause qui se vide. Un clic l'offre ; la croix laisse l'échec tout de suite ;
 *    sans geste, elle part à la fin de la pause. Le token n'est pas sur la scène affichée : en bas à droite de l'écran.
 *  - **menu contextuel** du moteur (MJ) : « Succès à un prix… » sur ce token tant que la pause dure (ui/pointer-menu.mjs).
 *  - **cartes** : sur un jet de dnd5e portant un DD et sur la ligne d'un jet demandé par le MJ (§242), raté de 1 ou 2, un bouton du MJ ;
 *    un jet accepté porte la marque « Réussite (à un prix) », vue de tous.
 * Côté joueur : rien à offrir (c'est le MJ qui offre) ; la question lui arrive en fenêtre (adapter/success-at-cost.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { esc, loc } from "../runtime/shared.mjs";
import { saveInResolution } from "../runtime/engine-messages.mjs";
import { AT_COST_CANDIDATE_HOOK, atCostCandidateOn, atCostEnabled, atCostLabel, dismissAtCost, nativeCandidate, offerAtCost, offerOnMessage,
  offerOnRow, rowCandidate } from "../runtime/success-at-cost.mjs";

/** Les pastilles affichées, par id d'occasion. */
const pills = new Map();
let ticking = false;

function dock() {
  let el = document.getElementById("das-at-cost-dock");
  if ( !el ) {
    el = document.createElement("div");
    el.id = "das-at-cost-dock";
    document.body.append(el);
  }
  return el;
}

function build(c) {
  const el = document.createElement("div");
  el.className = "das-at-cost-pill";
  el.innerHTML = `<svg class="das-at-cost-pill__ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"></circle></svg>`
    + `<i class="fa-solid fa-scale-balanced"></i>`
    + `<span class="das-at-cost-pill__text"><b>${esc(loc("APrix.Pastille", { by: c.by }))}</b><small>${esc(c.name)} · ${esc(c.what)}</small></span>`
    + `<i class="fa-solid fa-xmark das-at-cost-pill__close" data-tooltip="${esc(loc("APrix.LaisserEchec"))}"></i>`;
  el.dataset.tooltip = loc("APrix.PastilleAide", { total: c.total, needed: c.needed });
  el.addEventListener("click", event => {
    event.stopPropagation();
    if ( event.target.closest(".das-at-cost-pill__close") ) dismissAtCost(c.id);
    else offerAtCost(c.id);
  });
  return el;
}

/** À chaque image : la pastille au-dessus de son token (ou dans le coin), et l'anneau de la pause. */
function tick() {
  const now = Date.now();
  for ( const pill of pills.values() ) {
    const token = pill.c.token ? fromUuidSync(pill.c.token, { strict: false })?.object : null;
    const onScene = token && !token.destroyed && (token.document.parent === canvas.scene);
    if ( onScene ) {
      const { x, y } = canvas.clientCoordinatesFromCanvas({ x: token.center.x, y: token.y });
      if ( pill.el.parentElement !== document.body ) document.body.append(pill.el);
      pill.el.classList.add("floating");
      pill.el.style.left = `${Math.round(x)}px`;
      pill.el.style.top = `${Math.round(y)}px`;
    }
    else if ( pill.el.parentElement !== dock() ) {
      pill.el.classList.remove("floating");
      pill.el.style.left = pill.el.style.top = "";
      dock().append(pill.el);
    }
    const left = pill.c.claimed ? 1 : Math.max(0, (pill.c.deadline - now) / (pill.c.seconds * 1000));
    pill.el.style.setProperty("--left", String(left));
    pill.el.classList.toggle("claimed", !!pill.c.claimed);
  }
  if ( pills.size ) requestAnimationFrame(tick);
  else ticking = false;
}

function onCandidate(c) {
  if ( !game.user.isGM ) return;
  if ( c.closed ) {
    pills.get(c.id)?.el.remove();
    pills.delete(c.id);
    return;
  }
  const pill = pills.get(c.id);
  if ( pill ) { pill.c = c; return; }
  pills.set(c.id, { c, el: build(c) });
  if ( !ticking ) { ticking = true; requestAnimationFrame(tick); }
}

/** Le menu contextuel du moteur (MJ) : l'entrée tant que la pause dure sur ce token. */
export function atCostMenuEntry(target) {
  if ( !game.user.isGM ) return null;
  const c = atCostCandidateOn(target?.uuid ?? target?.document?.uuid ?? null);
  if ( !c || c.claimed ) return null;
  return { icon: "fa-solid fa-scale-balanced", label: loc("APrix.Menu", { by: c.by }), run: () => offerAtCost(c.id) };
}

/* -------------------------------------------- */
/*  Cartes                                      */
/* -------------------------------------------- */

function button(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "das-at-cost-button";
  b.innerHTML = `<i class="fa-solid fa-scale-balanced"></i> ${esc(label)}`;
  b.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    b.disabled = true;
    try { await onClick(); } finally { b.disabled = false; }
  });
  return b;
}

function mark(flag) {
  const p = document.createElement("p");
  p.className = "das-at-cost-mark";
  p.innerHTML = `<i class="fa-solid fa-scale-balanced"></i> ${atCostLabel(flag)}`;
  return p;
}

/** Ce que le jet teste, d'après sa carte (son en-tête), sinon « test ». */
function whatOf(message) {
  const flavor = new DOMParser().parseFromString(String(message.flavor ?? ""), "text/html").body.textContent?.trim();
  return flavor || loc("APrix.Test");
}

/** Un jet de dnd5e portant un DD : la marque, ou le bouton du MJ. */
function onRenderRoll(message, html) {
  const root = (html instanceof HTMLElement) ? html : html?.[0];
  if ( !root ) return;
  root.querySelectorAll(".das-at-cost-mark, .das-at-cost-button").forEach(e => e.remove());
  const flag = message.getFlag(MODULE_ID, "atCost");
  const content = root.querySelector(".message-content") ?? root;
  if ( flag ) {
    // Le jet de dnd5e reste « échec » sous ses dés : la marque le dit réussi, et l'état du total suit.
    root.querySelectorAll(".dice-total.failure").forEach(e => { e.classList.remove("failure"); e.classList.add("success"); });
    content.append(mark(flag));
    return;
  }
  if ( !game.user.isGM || !atCostEnabled() || message.getFlag(MODULE_ID, "groupRollResult") ) return;
  if ( (message.type === "save") && saveInResolution(message) ) return;
  if ( !nativeCandidate(message) ) return;
  content.append(button(loc("APrix.Bouton"), () => offerOnMessage(message.id, { what: whatOf(message) })));
}

/**
 * La carte d'un jet demandé par le MJ (§242) : le bouton sur chaque ligne ratée de 1 ou 2, la marque sur chaque ligne acceptée. Appelée
 * par ui/group-roll.mjs après son propre dessin, avec le point de la carte.
 */
export function decorateGroupCard(message, root, view, { what }) {
  for ( const item of root.querySelectorAll(".targets [data-uuid]") ) {
    item.querySelectorAll(".das-at-cost-mark, .das-at-cost-button").forEach(e => e.remove());
    const entry = view.entries.find(e => e.uuid === item.dataset.uuid);
    if ( !entry ) continue;
    if ( entry.atCost ) { item.append(mark(entry.atCost)); continue; }
    if ( !game.user.isGM || !atCostEnabled() ) continue;
    const row = rowCandidate(entry, view.request);
    if ( !row ) continue;
    item.append(button(loc("APrix.Bouton"), () => offerOnRow(message.id, { ...row, what })));
  }
}

export function registerSuccessAtCostUI() {
  route(AT_COST_CANDIDATE_HOOK, onCandidate, { label: "success at a cost: GM pill" });
  route("dnd5e.renderChatMessage", onRenderRoll, { label: "success at a cost: card" });
  // Le jet marqué : sa carte se redessine (et celle de la demande qui le compte, ui/group-roll.mjs).
  route("updateChatMessage", (message, changes) => {
    if ( foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.atCost`) ) ui.chat?.updateMessage?.(message);
  }, { label: "success at a cost: card refresh" });
}

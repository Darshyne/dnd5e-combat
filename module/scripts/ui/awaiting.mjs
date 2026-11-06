/**
 * §381 (issue #35) : sous le token de la créature qu'on attend — une réaction, un choix, un jet ouvert chez un joueur ou chez le MJ —,
 * trois points qui ondulent, comme une conversation où quelqu'un écrit, vus par toute la table sauf celui qui répond (d'abord un sablier ;
 * l'utilisateur a préféré les points le 2026-11-06). Un filet se vide sous la bulle avec le délai de la fenêtre, s'il y en a un ; le nom
 * de qui doit répondre dessous (réglage de monde `awaitingNames`). Jamais ce que la fenêtre demande.
 *
 * Une fenêtre du MJ pour une créature sans joueur : selon `awaitingGm`, un bandeau « Le MJ décide… » sans désigner de créature (défaut),
 * les points sous le token, ou rien — le MJ voit toujours les points.
 *
 * Chaque client dessine lui-même, dans `canvas.interface`, à la position affichée du token, et seulement s'il voit le token
 * (`Token#isVisible`). Rien n'est écrit dans un document. État : adapter/awaiting.mjs ; règles d'affichage : core/awaiting.mjs.
 */

import { awaitingAlive, awaitingLeft, awaitingPlacement } from "../core/awaiting.mjs";
import { TIMER_GRADIENT } from "../core/timers.mjs";
import { AWAITING_HOOK, awaitingList } from "../adapter/awaiting.mjs";
import { AWAITING_SETTINGS_HOOK, awaitingViewer } from "../runtime/awaiting.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

const BANNER_ID = "das-awaiting-banner";
/**
 * Trois points qui ondulent sous le token, comme une conversation où quelqu'un écrit (demande de l'utilisateur, 2026-11-06 : le sablier
 * plaisait moyennement). Dimensions en fraction d'une case ; un cycle d'ondulation ; le décalage d'un point au suivant.
 */
const DOT = 0.045;
const GAP = 0.05;
const PILL_PAD = 0.045;
const WAVE_MS = 1200;
const STAGGER = 0.18;

/** Les indicateurs dessinés sur ce client : id de l'attente → vue. */
const views = new Map();
let layer = null;
let ticking = false;
let entries = [];

const accent = () => Number.parseInt(TIMER_GRADIENT[1].slice(1), 16);

function layerOf() {
  if ( !layer || layer.destroyed || (layer.parent !== canvas.interface) ) {
    layer = canvas.interface.addChild(new PIXI.Container());
    layer.eventMode = "none";
    // `canvas.interface` trie ses enfants : le calque des tokens y est à 200 (vu en jeu, V14) — au-dessus des contrôles, pour que les
    // points et le nom ne passent pas sous l'image d'un token.
    layer.zIndex = 1050;
  }
  return layer;
}

/** Le dessin : une bulle sombre au filet blanc, trois points, le filet du délai sous la bulle, le nom dessous. */
function build(entry, names) {
  const size = canvas.grid.size;
  const r = Math.max(3, DOT * size);
  const gap = Math.max(3, GAP * size);
  const pad = Math.max(4, PILL_PAD * size);
  const w = (6 * r) + (2 * gap) + (2 * pad);
  const h = (2 * r) + (2 * pad);
  const root = new PIXI.Container();
  const back = new PIXI.Graphics().beginFill(0x000000, 0.65).drawRoundedRect(-w / 2, 0, w, h, h / 2).endFill()
    .lineStyle(1.5, 0xffffff, 0.85).drawRoundedRect(-w / 2, 0, w, h, h / 2);
  const bar = new PIXI.Graphics();
  const dots = [-1, 0, 1].map(i => {
    const dot = new PIXI.Graphics().beginFill(0xffffff, 1).drawCircle(0, 0, r).endFill();
    dot.position.set(i * ((2 * r) + gap), h / 2);
    return dot;
  });
  root.addChild(back, bar, ...dots);
  if ( names && entry.userName ) {
    const name = new PIXI.Text(entry.userName, { fontFamily: CONFIG.canvasTextStyle?.fontFamily ?? "Signika",
      fontSize: Math.round(Math.max(10, size * 0.13)), fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
    name.anchor.set(0.5, 0);
    name.position.set(0, h + 4);
    root.addChild(name);
  }
  return { root, bar, dots, r, w, h, left: -1, born: Date.now() };
}

/** Le filet du délai sous la bulle : plein à l'ouverture, vide à la fin. Sans délai : rien. */
function drawBar(view, left) {
  const rounded = (left === null) ? null : Math.round(left * 100) / 100;
  if ( rounded === view.left ) return;
  view.left = rounded;
  view.bar.clear();
  if ( rounded === null || rounded <= 0 ) return;
  const inset = view.h / 2;
  const full = view.w - (2 * inset);
  view.bar.lineStyle(2, accent(), 1).moveTo(-full / 2, view.h + 1).lineTo((-full / 2) + (full * rounded), view.h + 1);
}

/** L'ondulation : chaque point monte puis redescend, un peu après le précédent, et s'éclaire au sommet. */
function wave(view, now) {
  const t = ((now - view.born) % WAVE_MS) / WAVE_MS;
  view.dots.forEach((dot, i) => {
    const p = (t - (i * STAGGER) + 1) % 1;
    const lift = p < 0.5 ? Math.sin(p * 2 * Math.PI) : 0;
    dot.position.y = (view.h / 2) - Math.max(0, lift) * view.r * 0.8;
    dot.alpha = 0.45 + (0.55 * Math.max(0, lift));
  });
}

function drop(id) {
  const view = views.get(id);
  if ( !view ) return;
  views.delete(id);
  view.root.destroy({ children: true });
}

function tick() {
  const now = Date.now();
  const viewer = awaitingViewer();
  const shown = new Set();
  for ( const entry of entries ) {
    if ( !awaitingAlive(entry, now) || (awaitingPlacement(entry, viewer) !== "token") ) continue;
    const doc = fromUuidSync(entry.token ?? "", { strict: false });
    const token = doc?.object;
    if ( !token || token.destroyed || (doc.parent !== canvas.scene) ) continue;
    shown.add(entry.id);
    let view = views.get(entry.id);
    if ( !view ) views.set(entry.id, view = build(entry, viewer.names));
    if ( view.root.parent !== layerOf() ) layerOf().addChild(view.root);
    view.root.visible = token.isVisible === true;
    // En bas du token, centré, à cheval sur son bord (demande de l'utilisateur) : la place des minuteries (au-dessus) et des textes qui
    // défilent reste libre, et la bulle ne descend pas sur le nom du token.
    view.root.position.set(token.center.x, token.y + token.h - (view.h / 2));
    wave(view, now);
    drawBar(view, awaitingLeft(entry, now));
  }
  for ( const id of [...views.keys()] ) if ( !shown.has(id) ) drop(id);
  updateBanner(now, viewer);
  if ( !views.size && !entries.length ) stopTicking();
}

/** Le bandeau discret « Le MJ décide… » : une fenêtre du MJ pour une créature qu'on ne désigne pas. */
function updateBanner(now, viewer) {
  const wanted = entries.some(e => awaitingAlive(e, now) && (awaitingPlacement(e, viewer) === "banner"));
  let banner = document.getElementById(BANNER_ID);
  if ( !wanted ) { banner?.remove(); return; }
  if ( banner ) return;
  banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.className = "das-awaiting-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = `<span class="das-awaiting-dots" inert><i></i><i></i><i></i></span><span></span>`;
  banner.querySelector("span").textContent = loc("Attente.MJDecide");
  document.body.append(banner);
}

function startTicking() {
  if ( ticking || !canvas?.app?.ticker ) return;
  canvas.app.ticker.add(tick);
  ticking = true;
}
function stopTicking() {
  if ( !ticking ) return;
  canvas.app?.ticker?.remove(tick);
  ticking = false;
}

function onAwaiting(list) {
  entries = Array.isArray(list) ? list : [];
  // Le bandeau est du HTML : posé ici aussi, sans attendre le ticker du canevas (arrêté dans un onglet en arrière-plan, vu en jeu).
  updateBanner(Date.now(), awaitingViewer());
  if ( entries.length ) startTicking();
  else { for ( const id of [...views.keys()] ) drop(id); document.getElementById(BANNER_ID)?.remove(); }
}

function clear() {
  for ( const id of [...views.keys()] ) drop(id);
  stopTicking();
  layer = null;
}

export function registerAwaitingUI() {
  route(AWAITING_HOOK, onAwaiting, { always: true, label: "awaiting: typing dots not drawn" });
  route("canvasReady", () => onAwaiting(awaitingList()), { always: true, label: "awaiting: typing dots not redrawn with the canvas" });
  route("canvasTearDown", clear, { always: true, label: "awaiting: typing dots not cleared with the canvas" });
  // Un réglage d'affichage change (monde ou client) : redessiner (nom, mode du MJ).
  route(AWAITING_SETTINGS_HOOK, () => {
    clear();
    onAwaiting(awaitingList());
  }, { always: true, label: "awaiting: typing dots not refreshed after a setting change" });
}

/** `api.ui.awaiting()` : les attentes en cours connues de ce client (forme publique), et ce que ce client en montre. */
export function awaitingState() {
  const viewer = awaitingViewer();
  return awaitingList().map(e => ({ ...e, shown: awaitingPlacement(e, viewer) }));
}

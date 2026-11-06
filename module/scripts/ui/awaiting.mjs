/**
 * §381 (issue #35) : le sablier au-dessus du token de la créature qu'on attend — une réaction, un choix, un jet ouvert chez un joueur ou
 * chez le MJ —, vu par toute la table sauf celui qui répond. Il se retourne tant que la fenêtre est ouverte ; un anneau se vide avec son
 * délai quand elle en a un ; le nom de qui doit répondre dessous (réglage de monde `awaitingNames`). Jamais ce que la fenêtre demande.
 *
 * Une fenêtre du MJ pour une créature sans joueur : selon `awaitingGm`, un bandeau « Le MJ décide… » sans désigner de créature (défaut),
 * le sablier sur le token, ou rien — le MJ voit toujours le sablier.
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

/** Le sablier de Font Awesome 6 (`hourglass-half`). */
const HOURGLASS = "";
const BANNER_ID = "das-awaiting-banner";
/** Taille, en fraction d'une case ; durée d'un cycle (le sablier se retourne, puis s'écoule). */
const SIZE = 0.3;
const CYCLE_MS = 2400;
const FLIP_MS = 450;

/** Les sabliers dessinés sur ce client : id de l'attente → vue. */
const views = new Map();
let layer = null;
let ticking = false;
let entries = [];

const accent = () => Number.parseInt(TIMER_GRADIENT[1].slice(1), 16);

function layerOf() {
  if ( !layer || layer.destroyed || (layer.parent !== canvas.interface) ) {
    layer = canvas.interface.addChild(new PIXI.Container());
    layer.eventMode = "none";
    // `canvas.interface` trie ses enfants : le calque des tokens y est à 200 (vu en jeu, V14) — au-dessus des contrôles, pour que le
    // sablier et le nom ne passent pas sous l'image d'un token.
    layer.zIndex = 1050;
  }
  return layer;
}

/** Le dessin d'un sablier : disque sombre, anneau du délai, sablier, nom. */
function build(entry, names) {
  const size = canvas.grid.size;
  const r = Math.max(10, SIZE * size / 2);
  const root = new PIXI.Container();
  const back = new PIXI.Graphics().beginFill(0x000000, 0.6).drawCircle(0, 0, r).endFill()
    .lineStyle(2, 0xffffff, 0.9).drawCircle(0, 0, r);
  const ring = new PIXI.Graphics();
  const glass = new PIXI.Text(HOURGLASS, {
    fontFamily: ["Font Awesome 6 Pro", "Font Awesome 6 Free", "FontAwesome"], fontWeight: "900", fontSize: Math.round(r * 1.1),
    fill: 0xffffff, stroke: 0x000000, strokeThickness: 2
  });
  glass.anchor.set(0.5);
  root.addChild(back, ring, glass);
  if ( names && entry.userName ) {
    const name = new PIXI.Text(entry.userName, { fontFamily: CONFIG.canvasTextStyle?.fontFamily ?? "Signika",
      fontSize: Math.round(Math.max(10, r * 0.75)), fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
    name.anchor.set(0.5, 0);
    name.position.set(0, r + 2);
    root.addChild(name);
  }
  return { root, ring, glass, r, left: -1, born: Date.now() };
}

/** L'anneau du délai : plein à l'ouverture, vide à la fin. Sans délai : pas d'anneau. */
function drawRing(view, left) {
  const rounded = (left === null) ? null : Math.round(left * 100) / 100;
  if ( rounded === view.left ) return;
  view.left = rounded;
  view.ring.clear();
  if ( rounded === null || rounded <= 0 ) return;
  const start = -Math.PI / 2;
  view.ring.lineStyle(3, accent(), 1).arc(0, 0, view.r + 3, start, start + (Math.PI * 2 * rounded));
}

/** Le retournement : un demi-tour au début de chaque cycle, puis le sablier s'écoule à l'arrêt. */
function flipAngle(view, now) {
  const t = (now - view.born) % CYCLE_MS;
  const turns = Math.floor((now - view.born) / CYCLE_MS);
  const p = Math.min(1, t / FLIP_MS);
  const eased = p < 0.5 ? 2 * p * p : 1 - (Math.pow(-2 * p + 2, 2) / 2);
  return (turns + eased) * Math.PI;
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
    // Coin haut droit du token : la place des minuteries (au-dessus) et des textes qui défilent (au centre) reste libre.
    view.root.position.set(token.x + token.w - (view.r * 0.6), token.y + (view.r * 0.6));
    view.glass.rotation = flipAngle(view, now);
    drawRing(view, awaitingLeft(entry, now));
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
  banner.innerHTML = `<i class="fa-solid fa-hourglass-half" inert></i><span></span>`;
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
  if ( entries.length ) startTicking();
  else { for ( const id of [...views.keys()] ) drop(id); document.getElementById(BANNER_ID)?.remove(); }
}

function clear() {
  for ( const id of [...views.keys()] ) drop(id);
  stopTicking();
  layer = null;
}

export function registerAwaitingUI() {
  route(AWAITING_HOOK, onAwaiting, { always: true, label: "awaiting: hourglass not drawn" });
  route("canvasReady", () => onAwaiting(awaitingList()), { always: true, label: "awaiting: hourglass not redrawn with the canvas" });
  route("canvasTearDown", clear, { always: true, label: "awaiting: hourglass not cleared with the canvas" });
  // Un réglage d'affichage change (monde ou client) : redessiner (nom, mode du MJ).
  route(AWAITING_SETTINGS_HOOK, () => {
    clear();
    onAwaiting(awaitingList());
  }, { always: true, label: "awaiting: hourglass not refreshed after a setting change" });
}

/** `api.ui.awaiting()` : les attentes en cours connues de ce client (forme publique), et ce que ce client en montre. */
export function awaitingState() {
  const viewer = awaitingViewer();
  return awaitingList().map(e => ({ ...e, shown: awaitingPlacement(e, viewer) }));
}

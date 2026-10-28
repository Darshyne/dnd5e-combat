/**
 * §272 : minuteries au-dessus des tokens, vues de toute la table — un geste qui prend du temps (fouille, désamorçage…) montre, au-dessus
 * du token, un engrenage qui tourne et une jauge arrondie au filet blanc, remplie du dégradé du logo DAS (core/timers.mjs) ; les secondes
 * restantes à droite, sauf si la table les masque (réglage de monde `timerHideSeconds`).
 *
 * Chaque client la dessine lui-même, dans `canvas.interface`, au-dessus du token à sa position affichée, et seulement s'il voit le token
 * (`Token#isVisible` : caché par le MJ, hors de vue — rien). `start` la lance chez ce client et la diffuse aux autres (requête
 * `dnd5e-combat.timer`) ; `stop` l'arrête partout (geste interrompu). Rien n'est écrit dans un document.
 *
 * API pour les voisins : `api.ui.timer({ token, seconds, label?, icon?, id? })` → `{ id, done: Promise<void>, stop() }`.
 */

import { MODULE_ID } from "../constants.mjs";
import { TIMER_GRADIENT, TIMER_LAYOUT, timerSecondsText, timerState } from "../core/timers.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

export const TIMER_QUERY = `${MODULE_ID}.timer`;
export const TIMER_HIDE_SECONDS = "timerHideSeconds";

/** Les minuteries en cours sur ce client, par id. */
const timers = new Map();
let layer = null;
let gradient = null;
let ticking = false;

const hideSeconds = () => { try { return game.settings.get(MODULE_ID, TIMER_HIDE_SECONDS) === true; } catch { return false; } };

function layerOf() {
  if ( !layer || layer.destroyed || (layer.parent !== canvas.interface) ) {
    layer = canvas.interface.addChild(new PIXI.Container());
    layer.eventMode = "none";
  }
  return layer;
}

/** La texture du dégradé DAS (une bande de 256 × 1 px), créée une fois. */
function gradientTexture() {
  if ( gradient && !gradient.destroyed ) return gradient;
  const c = document.createElement("canvas");
  c.width = 256; c.height = 1;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  TIMER_GRADIENT.forEach((color, i) => g.addColorStop(i / (TIMER_GRADIENT.length - 1), color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);
  gradient = PIXI.Texture.from(c);
  return gradient;
}

/** Le dessin d'une minuterie : engrenage, fond, remplissage masqué en coins arrondis, filet blanc, secondes. */
function build(timer) {
  const size = canvas.grid.size;
  const w = TIMER_LAYOUT.width * size;
  const h = Math.max(8, TIMER_LAYOUT.height * size);
  const r = h / 2;
  const root = new PIXI.Container();
  const icon = new PIXI.Text(timer.icon === "gear" ? "" : timer.icon, {
    fontFamily: ["Font Awesome 6 Pro", "Font Awesome 6 Free", "FontAwesome"], fontWeight: "900", fontSize: Math.round(TIMER_LAYOUT.iconSize * size),
    fill: 0xffffff, stroke: 0x000000, strokeThickness: 3
  });
  icon.anchor.set(0.5);
  icon.position.set(-w / 2 - icon.width * 0.7, 0);
  const back = new PIXI.Graphics().beginFill(0x000000, 0.55).drawRoundedRect(-w / 2, -h / 2, w, h, r).endFill();
  const fill = new PIXI.Sprite(gradientTexture());
  fill.position.set(-w / 2, -h / 2);
  fill.height = h;
  fill.width = 0;
  const mask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-w / 2, -h / 2, w, h, r).endFill();
  fill.mask = mask;
  const outline = new PIXI.Graphics().lineStyle(TIMER_LAYOUT.outline, 0xffffff, 1).drawRoundedRect(-w / 2, -h / 2, w, h, r);
  const seconds = new PIXI.Text("", { fontFamily: CONFIG.canvasTextStyle?.fontFamily ?? "Signika", fontSize: Math.round(h * 1.4),
    fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
  seconds.anchor.set(0, 0.5);
  seconds.position.set(w / 2 + 6, 0);
  const label = new PIXI.Text(timer.label ?? "", { fontFamily: CONFIG.canvasTextStyle?.fontFamily ?? "Signika", fontSize: Math.round(h * 1.3),
    fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
  label.anchor.set(0.5, 1);
  label.position.set(0, -h / 2 - 2);
  root.addChild(back, fill, mask, outline, icon, seconds, label);
  return { root, icon, fill, seconds, width: w, height: h };
}

/** À chaque image : position au-dessus du token, visibilité, rotation de l'engrenage, remplissage, secondes ; fin. */
function tick(ticker) {
  const now = Date.now();
  for ( const timer of [...timers.values()] ) {
    const token = canvas.tokens?.get(timer.tokenId);
    if ( !token || token.destroyed || (token.document.parent !== canvas.scene) ) { if ( timer.view ) timer.view.root.visible = false; continue; }
    timer.view ??= build(timer);
    if ( timer.view.root.parent !== layerOf() ) layerOf().addChild(timer.view.root);
    const view = timer.view;
    view.root.visible = token.isVisible === true;
    view.root.position.set(token.center.x, token.y - (TIMER_LAYOUT.gap * canvas.grid.size) - view.height);
    view.icon.rotation += 0.06 * (ticker?.deltaTime ?? 1);
    const state = timerState(timer, now);
    view.fill.width = view.width * state.pct;
    view.seconds.text = timerSecondsText(state.left, { hideSeconds: hideSeconds(), unit: loc("Minuterie.Secondes") });
    if ( state.done ) finish(timer.id);
  }
  if ( !timers.size ) stopTicking();
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

function finish(id) {
  const timer = timers.get(id);
  if ( !timer ) return;
  timers.delete(id);
  timer.view?.root.destroy({ children: true });
  timer.resolve?.();
}

/** Chez ce client : une minuterie (ou son arrêt). */
function receive({ action="start", id, token, seconds, label="", icon="gear", startedAt=null }={}) {
  if ( action === "stop" ) { finish(id); return true; }
  const doc = fromUuidSync(token ?? "", { strict: false });
  if ( !doc || !(seconds > 0) ) return false;
  finish(id);
  // L'heure de départ de l'émetteur, si elle est plausible (horloges voisines), sinon maintenant.
  const began = (Number.isFinite(startedAt) && (Math.abs(Date.now() - startedAt) < 5000)) ? startedAt : Date.now();
  timers.set(id, { id, tokenId: doc.id, seconds, label, icon, startedAt: began, view: null });
  startTicking();
  return true;
}

function broadcast(payload) {
  for ( const user of game.users ) {
    if ( !user.active || user.isSelf ) continue;
    user.query(TIMER_QUERY, payload, { timeout: 5000 }).catch(() => {});
  }
}

/**
 * Lance une minuterie au-dessus d'un token, chez tous les clients connectés.
 * @param {{token: TokenDocument|Token|string, seconds: number, label?: string, icon?: string, id?: string}} options
 * @returns {{id: string, done: Promise<void>, stop: Function}}
 */
export function startTimer({ token, seconds, label="", icon="gear", id=null }={}) {
  const uuid = (typeof token === "string") ? token : (token?.document?.uuid ?? token?.uuid ?? null);
  const key = id ?? foundry.utils.randomID();
  const payload = { action: "start", id: key, token: uuid, seconds: Number(seconds) || 0, label, icon, startedAt: Date.now() };
  let resolve;
  const done = new Promise(r => { resolve = r; });
  if ( !uuid || !(payload.seconds > 0) || !canvas?.ready ) { resolve(); return { id: key, done, stop() {} }; }
  receive(payload);
  const local = timers.get(key);
  if ( local ) local.resolve = resolve; else resolve();
  broadcast(payload);
  return {
    id: key, done,
    stop() { finish(key); broadcast({ action: "stop", id: key }); }
  };
}

export function registerTimers() {
  game.settings.register(MODULE_ID, TIMER_HIDE_SECONDS, { scope: "world", config: true, type: Boolean, default: false,
    name: `DND5ECOMBAT.Reglage.${TIMER_HIDE_SECONDS}.Nom`, hint: `DND5ECOMBAT.Reglage.${TIMER_HIDE_SECONDS}.Aide` });
  CONFIG.queries[TIMER_QUERY] = receive;
  route("canvasTearDown", () => { for ( const id of [...timers.keys()] ) finish(id); stopTicking(); layer = null; }, { label: "timers: not cleared with the canvas" });
}

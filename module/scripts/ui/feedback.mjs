/**
 * Retour visuel au-dessus des tokens, façon BG3 (SPEC §15.3) : « Critique ! », « Raté », l'abri, la
 * réaction, la sauvegarde — à la manière du texte défilant du cœur (`canvas.interface.createScrollingText`,
 * client/canvas/groups/interface.mjs:174), celui que dnd5e utilise pour les PV
 * (documents/actor/actor.mjs:3557). Les PV eux-mêmes restent au système.
 *
 * Consommateur passif : le hook `dnd5e-combat.resolution` n'est publié que chez le MJ actif, qui
 * exécute le moteur ; ici chaque client lit la résolution sur le drapeau du message, qu'il reçoit
 * comme tout le monde, et n'écrit que ce qui a changé depuis l'état précédent (core/feedback.mjs).
 * Rien n'est décidé, rien n'est écrit dans le monde.
 *
 * §228 : le moteur dessine ses textes lui-même (un conteneur dans `canvas.interface`, animé par `CanvasAnimation` du cœur) au lieu du
 * texte défilant du cœur, qui efface son texte pendant toute sa course et n'accepte pas d'image : rythme, course, taille, ce qui
 * s'affiche et pictogrammes (dé et total du jet) sont réglés par le MJ pour la table (onglet « Textes flottants »). Le réglage du cœur
 * « texte défilant » (`core.scrollingStatusText`) reste respecté. Les PV perdus ou rendus restent ceux de dnd5e
 * (documents/actor/actor.mjs:3557, `_displayTokenEffect`) : leur rythme n'est pas réglable sans patcher le système.
 */

import { MODULE_ID } from "../constants.mjs";
import { feedbackBetween } from "../core/feedback.mjs";
import { FLOAT_CATEGORY_DEFAULTS, FLOAT_DEFAULTS, FLOAT_ICONS, floatLine, floatLabel, floatFrame, floatDelays, checkKind, floatStyleOf, floatOffset,
  floatEntrance, hpFloat, floatOutcome, floatRolled, spinPhase } from "../core/float-text.mjs";
import { route } from "../runtime/router.mjs";
import { loc, NOTICE_QUERY, receiveNotice, waitForDice, isExecutor } from "../runtime/shared.mjs";
import { resourceChangesOf } from "../adapter/limits.mjs";
import { keyLabel } from "../adapter/group-roll.mjs";
import { d20Mode } from "../adapter/messages.mjs";

/** Dernier état vu, par message. */
const seen = new Map();
/** Un message qu'on n'a jamais vu passer : on n'en montre les faits que s'il est récent (pas un vieux message rejoué). */
const FRESH_MS = 120000;
/** Par token, l'heure (ms) où son prochain texte peut partir (core/float-text.mjs, `floatDelays`). */
const busyUntil = new Map();
/** Le conteneur des textes, recréé avec le canevas. */
let layer = null;

/**
 * §400 : l'allure de chaque sorte vient du thème du monde (réglage `floatTheme`, importé en JSON depuis l'atelier ; core/float-text.mjs,
 * `floatStyleOf`). Sans thème, celle d'avant : invite orange (Rebond !), refus rouge (Trop loin), fin d'effet bleue, ressource rendue verte,
 * dépensée orange, dégâts en plus rouges (§223), Inspiration héroïque dorée (§282), succès à un prix ambré (issue #32), tests (§292).
 */
const THEME_SETTING = "floatTheme";
/** §400 : le réglage de monde qui met les textes du moteur à la place de ceux du système ; et la trace d'avoir coupé ceux du cœur. */
export const FLOAT_SYSTEM = "floatSystem";
const CORE_MUTED = "floatCoreMuted";
let themeCache = null;
/** Par token, le côté du dernier texte en arc : ils alternent gauche / droite. */
const lastSide = new Map();

function theme() {
  if ( themeCache ) return themeCache;
  try { themeCache = game.settings.get(MODULE_ID, THEME_SETTING) ?? {}; } catch { themeCache = {}; }
  return themeCache;
}

/** Les textes flottants du moteur sont-ils ceux de la table (réglage de monde) ? */
export function floatsActive() {
  try { return !!game.settings.get(MODULE_ID, FLOAT_SYSTEM); } catch { return true; }
}

/** Une couleur `#rrggbb` en nombre PIXI. */
const hexNumber = c => Number.parseInt(String(c ?? "#ffffff").slice(1), 16) || 0xffffff;

function textOf(f) {
  switch ( f.kind ) {
    case "critical": return loc("Retour.Critique");
    case "miss": return loc("Retour.Rate");
    case "hit": return null;   // §228 : « Touché » ou le jet seul (core/float-text.mjs, `floatLine`)
    case "cover": return (f.degree === "total") ? loc("Retour.AbriTotal") : loc(`Abri.${f.degree}`);
    case "reaction": return f.name;
    case "saveSuccess": return loc("Retour.SauvegardeReussie");
    case "saveFail": return loc(f.auto ? "Retour.SauvegardeRateeOffice" : "Retour.SauvegardeRatee");
    case "duplicate": return loc("Retour.Replique");
    case "unaffected": return loc("Retour.NonAffecte");
    case "prompt": case "refused": case "ended": case "gain": case "spend": case "strike": case "heroic": case "atCost":
    case "check": case "checkSuccess": case "checkFail":
    case "damage": case "healing": case "temp": case "effectOn": case "effectOff": return f.text;
  }
  return null;
}

/** Un réglage du module, ou sa valeur par défaut s'il n'est pas (encore) enregistré. */
function option(key, fallback) {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; }
  catch { return fallback; }
}

/** Les réglages de la table (§228), lus à chaque salve : un changement du MJ vaut tout de suite. */
function floatOptions() {
  const show = Object.fromEntries(Object.entries(FLOAT_CATEGORY_DEFAULTS).map(([key, value]) => [key, !!option(key, value)]));
  return {
    show, dice: !!option("floatDice", true), icons: !!option("floatIcons", true), hitText: loc("Retour.Touche"),
    modeText: { advantage: loc("Retour.Avantage"), disadvantage: loc("Retour.Desavantage") }, modeJoiner: loc("Retour.AvecMode"),
    duration: Number(option("floatDuration", FLOAT_DEFAULTS.duration)) || FLOAT_DEFAULTS.duration,
    spacing: Number(option("floatSpacing", FLOAT_DEFAULTS.spacing)),
    distance: Number(option("floatDistance", FLOAT_DEFAULTS.distance)) || FLOAT_DEFAULTS.distance,
    scale: (Number(option("floatScale", FLOAT_DEFAULTS.scale)) || FLOAT_DEFAULTS.scale) / 100,
    up: option("floatDirection", FLOAT_DEFAULTS.direction) === "up"
  };
}

/**
 * Le conteneur des textes, dans le groupe d'interface (au-dessus du groupe primaire, où sont dessinés les tokens) et, §400, au-dessus de
 * tous ses calques : tokens (200), contrôles (1000) et texte défilant du cœur (1100, config.mjs `zIndexScrollingText`) — un texte n'est
 * jamais masqué par un token.
 */
function layerOf() {
  if ( !layer || layer.destroyed || (layer.parent !== canvas.interface) ) {
    layer = canvas.interface.addChild(new PIXI.Container());
    layer.eventMode = "none";
    layer.interactiveChildren = false;
    layer.zIndex = 1200;
  }
  return layer;
}

/** Une image du cœur (blanche), à la hauteur du texte et teinte de sa couleur. */
async function iconSprite(src, size, tint) {
  const texture = await foundry.canvas.loadTexture(src).catch(() => null);
  if ( !texture ) return null;
  const sprite = new PIXI.Sprite(texture);
  sprite.width = sprite.height = size;
  sprite.tint = tint;
  return sprite;
}

/** §400 : le cadre d'un pictogramme (hexagone pointe en haut, ou cercle), rempli et bordé aux couleurs du thème. */
function badgeShape(kind, size, fill, border, weight=1) {
  const g = new PIXI.Graphics();
  g.lineStyle(Math.max(1.5, size * 0.06) * weight, border, 1).beginFill(fill, 1);
  const r = size / 2;
  if ( kind === "circle" ) g.drawCircle(r, r, r * 0.92);
  else g.drawPolygon(Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3 * i) - (Math.PI / 2);
    return [r + (Math.cos(a) * r * 0.95), r + (Math.sin(a) * r * 0.95)];
  }).flat());
  return g.endFill();
}

/** §400 : le pictogramme du thème (un nom de l'atelier ou un chemin), éventuellement dans son cadre. */
async function themedIcon(style, fontSize) {
  const src = FLOAT_ICONS[style.icon] ?? ((style.icon in FLOAT_ICONS) ? null : style.icon);
  if ( !src ) return null;
  if ( style.badge === "none" ) return iconSprite(src, fontSize * 1.15, hexNumber(style.color));
  const size = fontSize * 1.7;
  const box = new PIXI.Container();
  box.addChild(badgeShape(style.badge, size, hexNumber(style.badgeColor), hexNumber(style.badgeBorder)));
  const sprite = await iconSprite(src, size * 0.56, hexNumber(style.badgeBorder));
  if ( sprite ) { sprite.position.set(size * 0.22, size * 0.22); box.addChild(sprite); }
  return box;
}

/**
 * §400, lot 2 : l’hexagone de jet (façon BG3) — fond et bordure du thème, le pictogramme de dé au centre. `step(phase)` (core/float-text.mjs,
 * `spinPhase`) : pendant le lancer, l’hexagone et le dé tournent ; à la révélation, le dé laisse la place au total, la bordure prend la
 * couleur de l’issue (`okColor` / `failColor`, gardée pour un jet neutre) et s’épaissit, et l’ensemble bat une fois.
 * @returns {Promise<{box: PIXI.Container, step: Function}>}
 */
async function spinner(look, fontSize, roll, kind) {
  const size = fontSize * 1.9;
  const box = new PIXI.Container();
  const inner = box.addChild(new PIXI.Container());
  inner.pivot.set(size / 2, size / 2);
  inner.position.set(size / 2, size / 2);
  const hex = inner.addChild(badgeShape("hex", size, hexNumber(look.badgeColor), hexNumber(look.badgeBorder)));
  const die = await iconSprite("icons/svg/d20.svg", size * 0.55, hexNumber(look.badgeBorder));
  if ( die ) { die.position.set(size * 0.225, size * 0.225); inner.addChild(die); }
  const { PreciseText } = foundry.canvas.containers;
  const number = new PreciseText(String(roll), PreciseText.getTextStyle({ fill: 0xffffff, fontSize: Math.round(fontSize * 0.9),
    fontFamily: look.font, fontWeight: "700", stroke: 0x000000, strokeThickness: 3 }));
  number.anchor.set(0.5);
  number.position.set(size / 2, size / 2);
  number.visible = false;
  box.addChild(number);
  const outcome = floatOutcome(kind);
  const border = hexNumber((outcome === "ok") ? look.okColor : (outcome === "fail") ? look.failColor : look.badgeBorder);
  let revealed = false;
  const step = phase => {
    if ( phase.spinning ) { inner.rotation = phase.angle; return; }
    if ( !revealed ) {
      revealed = true;
      inner.rotation = 0;
      if ( die ) die.visible = false;
      number.visible = true;
      hex.clear();
      inner.removeChild(hex);
      inner.addChildAt(badgeShape("hex", size, hexNumber(look.badgeColor), border, 2.2), 0);
    }
    inner.scale.set(phase.pulse);
    number.scale.set(phase.pulse);
  };
  return { box, step };
}

/**
 * Une ligne (pictogrammes, total du jet, texte) près du token, puis son animation, à l'allure de sa sorte dans le thème (§400) : police,
 * contour, halo, pictogramme encadré, apparition, et trajet — défile (vers le bas depuis le pied, ou vers le haut depuis la tête), reste
 * au-dessus de la tête, ou part en arc sur le côté (les arcs d'un même token alternent gauche / droite).
 */
async function drawLine(token, line, kind, options, { factor=1, roll=null }={}) {
  const look = floatStyleOf(theme(), kind);
  const fontSize = Math.round(look.size * options.scale * factor);
  const fill = hexNumber(look.color);
  const { PreciseText } = foundry.canvas.containers;
  const textStyle = { fill, fontSize, fontFamily: look.font, fontWeight: String(look.weight), fontStyle: look.italic ? "italic" : "normal",
    letterSpacing: look.tracking * fontSize, stroke: hexNumber(look.stroke), strokeThickness: look.strokeW };
  // Un halo : l'ombre portée du texte, sans décalage, floutée. Sans halo, l'ombre légère du cœur (config.mjs `canvasTextStyle`).
  if ( look.glow > 0 ) Object.assign(textStyle, { dropShadow: true, dropShadowBlur: look.glow, dropShadowColor: hexNumber(look.glowColor),
    dropShadowDistance: 0, dropShadowAlpha: 1, padding: Math.ceil(look.glow * 1.5) });
  const style = PreciseText.getTextStyle(textStyle);
  const parts = [];
  // §400, lot 2 : un jet dont la sorte a l'hexagone qui tourne — le dé tourne, puis le total s'inscrit au centre et la bordure prend la
  // couleur de l'issue ; le texte vient ensuite. Le total y est montré même sans « Résultat des dés » : c'est le sens de l'hexagone.
  const spin = (look.spin && floatRolled(kind) && Number.isFinite(roll)) ? await spinner(look, fontSize, roll, kind) : null;
  if ( spin ) parts.push(spin.box);
  else {
    const icon = options.icons ? await themedIcon(look, fontSize) : null;
    if ( line.dieIcon && (look.icon !== "d20") ) {
      const die = await iconSprite("icons/svg/d20.svg", fontSize * 1.15, fill);
      if ( die ) parts.push(die);
    }
    if ( icon ) parts.push(icon);
  }
  let label = floatLabel(spin ? { ...line, roll: null } : line, options.modeText, options.modeJoiner);
  if ( look.upper ) label = label.toLocaleUpperCase(game.i18n.lang);
  const text = label ? new PreciseText(label, style) : null;
  if ( text ) parts.push(text);
  if ( !parts.length || !canvas?.ready || !token.visible ) return;
  // Côte à côte, centrés verticalement.
  const box = new PIXI.Container();
  const gap = fontSize * 0.25;
  const height = Math.max(...parts.map(p => p.height));
  let x = 0;
  for ( const part of parts ) {
    part.position.set(x, (height - part.height) / 2);
    part.baseX = x;
    x += part.width + gap;
    box.addChild(part);
  }
  const width = x - gap;
  const { x: cx, y: cy } = token.center;
  const grid = canvas.grid.size;
  const motion = look.motion;
  // Le point de départ : défile vers le bas depuis le pied (dnd5e écrivait les PV depuis le centre en montant, actor.mjs:3557), vers
  // le haut depuis la tête ; reste au-dessus de la tête ; l'arc part du haut du token.
  const up = (motion === "anchor") || ((motion === "float") && options.up);
  const start = (motion === "anchor") ? cy - (token.h / 2) - (grid * 0.05)
    : (motion === "arc") ? cy - (token.h * 0.25)
    : up ? cy - (token.h / 2) : cy + (token.h / 2);
  box.pivot.set(width / 2, (motion === "arc") ? height / 2 : up ? height : 0);
  const path = { travel: (up ? -1 : 1) * options.distance * grid };
  if ( motion === "arc" ) {
    const id = token.document?.id ?? token.id;
    const side = -(lastSide.get(id) ?? 1);
    lastSide.set(id, side);
    Object.assign(path, { side, spread: look.spread * grid * (0.7 + (Math.random() * 0.6)), rise: grid * (0.5 + (Math.random() * 0.3)), drop: grid * 0.35 });
  }
  const s = canvas.dimensions.uiScale ?? 1;
  const x0 = cx + ((motion === "float") ? (Math.random() - 0.5) * 0.1 * width : 0);
  box.position.set(x0, start);
  box.alpha = 0;
  layerOf().addChild(box);
  const state = { p: 0 };
  // L’hexagone tourne puis se révèle : le texte reste lisible au moins 2,2 s après.
  const duration = spin ? Math.max(options.duration * 1000, look.spinMs + 2200) : options.duration * 1000;
  if ( spin && text ) text.alpha = 0;
  try {
    await foundry.canvas.animation.CanvasAnimation.animate([{ parent: state, attribute: "p", from: 0, to: 1 }], {
      context: box, duration,
      ontick: () => {
        if ( box.destroyed ) return;
        if ( spin ) {
          const phase = spinPhase(state.p * duration, look.spinMs);
          spin.step(phase);
          if ( text ) { text.alpha = phase.text; text.x = text.baseX - ((1 - phase.text) * fontSize * 0.4); }
        }
        const f = floatFrame(state.p);
        const e = floatEntrance(state.p, look.entrance);
        const o = floatOffset(state.p, motion, path);
        box.alpha = f.alpha;
        box.scale.set(e.scale * s);
        box.position.set(x0 + o.dx + e.dx, start + o.dy);
      }
    });
  } finally {
    // Les textures des pictogrammes sont celles du cache du cœur : on ne les détruit pas.
    if ( !box.destroyed ) box.destroy({ children: true, texture: false });
  }
}

function show(feedback) {
  // §400 : les textes du moteur dépendent de son interrupteur de monde (qui coupe ceux du cœur), plus du réglage du cœur.
  if ( !canvas?.ready || !floatsActive() ) return;
  const options = floatOptions();
  const lines = [];
  for ( const f of feedback ) {
    const token = fromUuidSync(f.token)?.object;
    if ( !token?.visible || token.document.isSecret ) continue;
    if ( floatStyleOf(theme(), f.kind).show === false ) continue;
    const raw = textOf(f);
    // « abri partiel » vient d'une clé partagée avec le chat
    const line = floatLine(f, raw ? raw.charAt(0).toLocaleUpperCase() + raw.slice(1) : null, options);
    if ( line ) lines.push({ f, token, line });
  }
  const delays = floatDelays(lines.map(l => l.f.token), options.spacing, Date.now(), busyUntil);
  lines.forEach(({ f, token, line }, i) => setTimeout(() => {
    if ( !canvas?.ready || !token.visible ) return;
    // §41.3 : si la vue change pendant le défilement (un escalier : autre niveau, le canevas est redessiné), le texte part avec le
    // canevas. Rien à rattraper.
    drawLine(token, line, f.kind, options, { factor: f.factor ?? 1, roll: Number.isFinite(f.roll) ? f.roll : null }).catch(() => {});
  }, delays[i]));
}

/**
 * §282 : l'éclat de l'Inspiration héroïque utilisée, sur le token, chez chaque client (l'avis voyage par `notice(…, { all: true })`) — un
 * soleil doré qui grandit et tourne, deux anneaux qui s'élargissent, ~1,4 s. Dessiné même sans textes flottants : c'est le retour visuel
 * de l'action.
 */
export async function heroicBurst(token, { color=0xffd24a, icon="icons/svg/sun.svg" }={}) {
  const placeable = (typeof token === "string") ? fromUuidSync(token)?.object : (token?.object ?? token);
  if ( !canvas?.ready || !placeable?.visible || placeable.document?.isSecret ) return;
  const gold = color;
  const size = Math.max(placeable.w, placeable.h);
  const box = new PIXI.Container();
  box.position.set(placeable.center.x, placeable.center.y);
  const rings = [0, 1].map(() => box.addChild(new PIXI.Graphics()));
  const texture = await foundry.canvas.loadTexture(icon).catch(() => null);
  const sun = texture ? box.addChild(new PIXI.Sprite(texture)) : null;
  if ( sun ) { sun.anchor.set(0.5); sun.tint = gold; }
  layerOf().addChild(box);
  const state = { p: 0 };
  try {
    await foundry.canvas.animation.CanvasAnimation.animate([{ parent: state, attribute: "p", from: 0, to: 1 }], {
      context: box, duration: 1400,
      ontick: () => {
        if ( box.destroyed ) return;
        const p = state.p;
        rings.forEach((g, i) => {
          const q = Math.min(1, Math.max(0, (p - (i * 0.2)) / 0.8));
          g.clear().lineStyle(Math.max(2, size * 0.04 * (1 - q)), gold, 0.9 * (1 - q)).drawCircle(0, 0, size * (0.45 + (0.55 * q)));
        });
        if ( sun ) {
          sun.alpha = (p < 0.25) ? p / 0.25 : Math.max(0, 1 - ((p - 0.25) / 0.75));
          sun.rotation = p * Math.PI;
          sun.width = sun.height = size * (0.6 + (0.5 * p));
        }
      }
    });
  } finally {
    if ( !box.destroyed ) box.destroy({ children: true, texture: false });
  }
}

/**
 * Un avis au-dessus d'un token, sur ce client : invite (« Rebond ! »), refus (« Déjà visé »), fin d'effet. Les invites et
 * refus sont ceux de qui agit — lui seul les voit, comme la visée qu'ils accompagnent.
 */
export function floatNotice(token, text, kind="prompt") {
  if ( !text || !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  show([{ token: token?.uuid ?? token, kind, text }]);
}

/** Le texte d'un changement de ressource (`resourceChangesOf`) : « +1 emplacement niv. 2 », « −1 Forme sauvage ». */
function resourceText(c) {
  const sign = c.kind === "gain" ? "+" : "−";
  return c.type === "spellSlots" ? loc("Retour.Emplacement", { sign, n: c.n, level: c.level }) : loc("Retour.Utilisation", { sign, n: c.n, item: c.name ?? "" });
}

/**
 * À la création d'un message, chez tout le monde : §16.40, ce qu'une utilisation a rendu ou dépensé (Regain sauvage), au-dessus du
 * token de l'utilisateur ; et un effet qui cesse sur dégâts (runtime/triggers.mjs, message `ended`), au-dessus de celui qui le portait.
 */
function onCreateMessage(message) {
  if ( (message.type === "usage") && game.settings.get(MODULE_ID, "feedbackText") && canvas?.ready
    && ((Date.now() - (message.timestamp ?? 0)) <= FRESH_MS) ) {
    const changes = resourceChangesOf(message);
    const actor = changes.length ? message.getAssociatedActor?.() : null;
    const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0];
    if ( token ) show(changes.map(c => ({ token: token.uuid, kind: c.kind, text: resourceText(c) })));
  }
  if ( message.type === "damage" ) showStrikes(message);
  if ( message.type === "check" ) showCheck(message).catch(() => {});
  const ended = message.getFlag?.(MODULE_ID, "ended");
  if ( !ended?.actor || !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  if ( (Date.now() - (message.timestamp ?? 0)) > FRESH_MS ) return;
  const actor = fromUuidSync(ended.actor, { strict: false });
  const token = actor?.getActiveTokens?.(false, true)?.[0];
  if ( token ) show([{ token: token.uuid, kind: "ended", text: loc("Retour.FinEffet", { item: fromUuidSync(ended.effect, { strict: false })?.name ?? ended.item ?? "" }) }]);
}

/**
 * §223 : chez tout le monde, au jet de dégâts d'un coup qui porte l'Attaque sournoise (runtime/sneak.mjs, drapeau `sneak`) ou des
 * dégâts bonus choisis par l'auteur (runtime/triggers.mjs, drapeau `bonuses`, parts `ask` : Frappe effroyable) : leur nom, en rouge,
 * au-dessus de la cible — comme une sauvegarde ratée.
 */
function showStrikes(message) {
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready || ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  const sneak = message.getFlag(MODULE_ID, "sneak");
  const chosen = (message.getFlag(MODULE_ID, "bonuses") ?? []).filter(b => b.ask);
  if ( !sneak && !chosen.length ) return;
  const target = sneak?.target ?? message.system?.targets?.[0]?.token ?? null;
  if ( !target ) return;
  const texts = [];
  if ( sneak ) texts.push(loc("Retour.AttaqueSournoise", { n: sneak.dice, faces: sneak.faces }));
  for ( const b of chosen ) texts.push(loc("Retour.DegatsChoisis", { name: b.name }));
  show(texts.map(text => ({ token: target, kind: "strike", text })));
}

/**
 * §292 : chez tout le monde, un test de caractéristique, de compétence ou d'outil lancé par dnd5e (message `check`, check-message-data.mjs
 * — §400 : l'initiative aussi, à part) : « 15 · Athlétisme », et avec un DD connu du jet (`options.target` : un DD caché aux joueurs n'en pose pas,
 * adapter/group-roll.mjs) « 15 · Athlétisme · Réussite ». Au-dessus du token qui a lancé, après les dés 3D ; un jet privé ou aveugle ne
 * s'affiche que chez qui peut le lire (`isContentVisible`).
 */
async function showCheck(message) {
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready || ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  const data = message.system ?? {};
  const roll = message.rolls?.[0];
  if ( !roll || !message.isContentVisible ) return;
  const actor = message.getAssociatedActor?.();
  const token = message.getAssociatedToken?.() ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0];
  if ( !token ) return;
  // §400, lot 2 : l’initiative, son total au-dessus du token (réglage « Afficher : initiative »).
  if ( data.type === "initiative" ) {
    await waitForDice(message);
    show([{ token: token.uuid, kind: "initiative", roll: roll.total, mode: d20Mode(roll), text: loc("Retour.Initiative") }]);
    return;
  }
  const label = data.skill ? keyLabel({ type: "skill", key: data.skill })
    : data.tool ? keyLabel({ type: "tool", key: data.tool }) : keyLabel({ type: "check", key: data.ability });
  const kind = checkKind({ total: roll.total, target: roll.options?.target, isSuccess: roll.isSuccess, isFailure: roll.isFailure });
  const verdict = { checkSuccess: loc("Retour.TestReussi"), checkFail: loc("Retour.TestRate") }[kind];
  await waitForDice(message);
  show([{ token: token.uuid, kind, roll: roll.total, mode: d20Mode(roll), text: [label, verdict].filter(Boolean).join(" · ") }]);
}

function onUpdateMessage(message, changes) {
  if ( !changes.flags?.[MODULE_ID]?.resolution ) return;
  const after = message.getFlag(MODULE_ID, "resolution");
  if ( !after ) return;
  const known = seen.has(message.id);
  const before = seen.get(message.id) ?? null;
  seen.set(message.id, foundry.utils.deepClone(after));
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  if ( !known && ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  show(feedbackBetween(before, after));
}

/**
 * §400 : les PV perdus, rendus ou temporaires, à la place du texte de dnd5e (documents/actor/actor.mjs:3532, `_displayTokenEffect`, coupé
 * avec le réglage du cœur) : même choix de sorte et de taille (`hpFloat`), chez chaque client — le hook est publié par la mise à jour de
 * l'acteur partout (data/actor/templates/attributes.mjs:715). dnd5e fait toujours luire l'anneau du token.
 */
function onHpChange(actor, changes) {
  if ( !floatsActive() || !canvas?.ready || !game.settings.get(MODULE_ID, "feedbackText") ) return;
  const hp = hpFloat(changes, actor?.system?.attributes?.hp?.max);
  if ( !hp ) return;
  const tokens = actor.isToken ? [actor.token] : actor.getActiveTokens(true, true);
  show(tokens.filter(Boolean).map(t => ({ token: t.uuid, kind: hp.kind, text: hp.value.signedString(), factor: hp.factor })));
}

/**
 * §400 : un effet qui commence ou cesse, à la place du texte du cœur (documents/active-effect.mjs:995-1052, `_displayScrollingStatus`) :
 * mêmes conditions — un effet qui modifie l'acteur, un état ou des changements, sans `animate: false` — et même texte « +(Nom) » / « −(Nom) ».
 */
function onEffect(effect, options, enabled) {
  if ( !floatsActive() || !canvas?.ready || !game.settings.get(MODULE_ID, "feedbackText") || (options?.animate === false) ) return;
  const actor = effect.target;
  if ( !(actor instanceof Actor) || !(effect.statuses?.size || effect.system?.changes?.length) ) return;
  const text = `${enabled ? "+" : "−"}(${effect.name})`;
  show(actor.getActiveTokens(true).map(t => ({ token: t.document.uuid, kind: enabled ? "effectOn" : "effectOff", text })));
}

/**
 * §400 : le MJ actif accorde le réglage du cœur « texte défilant » (monde) à l'interrupteur du moteur : textes du moteur → ceux du cœur et
 * du système (PV de dnd5e, effets, comportement de région « texte défilant ») coupés ; le moteur coupé → rendus, s'il les avait coupés lui-même.
 */
async function syncCoreText() {
  if ( !isExecutor() ) return;
  const core = game.settings.get("core", "scrollingStatusText");
  if ( floatsActive() ) {
    if ( core ) {
      await game.settings.set(MODULE_ID, CORE_MUTED, true);
      await game.settings.set("core", "scrollingStatusText", false);
    }
  } else if ( game.settings.get(MODULE_ID, CORE_MUTED) ) {
    await game.settings.set(MODULE_ID, CORE_MUTED, false);
    if ( !core ) await game.settings.set("core", "scrollingStatusText", true);
  }
}

/** §400 : les polices libres (OFL) livrées pour le thème, chargées par le cœur avec les siennes avant le canevas (game.mjs:1065). */
const FONTS = {
  "Cinzel": [{ urls: [`modules/${MODULE_ID}/fonts/cinzel.ttf`], weight: "400 900" }],
  "Cormorant Garamond": [{ urls: [`modules/${MODULE_ID}/fonts/cormorant-garamond.ttf`], weight: "300 700" }],
  "Alegreya SC": [{ urls: [`modules/${MODULE_ID}/fonts/alegreya-sc-medium.ttf`], weight: "500" },
    { urls: [`modules/${MODULE_ID}/fonts/alegreya-sc-bold.ttf`], weight: "700" }]
};

/** Les familles de polices de ce monde : celles du cœur et des modules, et celles que le MJ a ajoutées (Polices supplémentaires). */
export function floatFonts() {
  let added = {};
  try { added = game.settings.get("core", "fonts") ?? {}; } catch {}
  return [...new Set([...Object.keys(CONFIG.fontDefinitions ?? {}), ...Object.keys(added)])].sort((a, b) => a.localeCompare(b));
}

/** §400 : rejoue une sorte sur un token (essai depuis la fenêtre du thème, `api.floats.play`). */
export function playFloat(token, kind, text, extra={}) {
  const placeable = (typeof token === "string") ? fromUuidSync(token)?.object : (token?.object ?? token);
  if ( !placeable ) return false;
  themeCache = null;
  show([{ token: placeable.document.uuid, kind, text, ...extra }]);
  return true;
}

export function registerFeedback() {
  if ( CONFIG.fontDefinitions ) for ( const [family, fonts] of Object.entries(FONTS) ) CONFIG.fontDefinitions[family] ??= { editor: true, fonts };
  // §400 : l'interrupteur de la table, le thème, et la trace d'avoir coupé le texte du cœur.
  game.settings.register(MODULE_ID, FLOAT_SYSTEM, { scope: "world", config: true, type: Boolean, default: true,
    name: `DND5ECOMBAT.Reglage.${FLOAT_SYSTEM}.Nom`, hint: `DND5ECOMBAT.Reglage.${FLOAT_SYSTEM}.Aide`, onChange: () => syncCoreText() });
  game.settings.register(MODULE_ID, CORE_MUTED, { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, THEME_SETTING, { scope: "world", config: false, type: Object, default: {},
    onChange: () => { themeCache = null; } });
  game.settings.register(MODULE_ID, "feedbackText", { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.feedbackText.Nom", hint: "DND5ECOMBAT.Reglage.feedbackText.Aide" });
  // Le MJ actif n'est connu qu'un peu après `ready` (`game.users.activeGM`) : le réglage du cœur s'accorde ensuite.
  route("ready", () => { setTimeout(() => syncCoreText().catch(() => {}), 1500); }, { always: true, label: "floating texts: system texts muted" });
  route("dnd5e.damageActor", onHpChange, { always: true, label: "floating texts: hit points" });
  route("dnd5e.healActor", onHpChange, { always: true, label: "floating texts: hit points" });
  route("createActiveEffect", (e, o) => { if ( e.modifiesActor ) onEffect(e, o, true); }, { always: true, label: "floating texts: effect" });
  route("deleteActiveEffect", (e, o) => { if ( e.modifiesActor ) onEffect(e, o, false); }, { always: true, label: "floating texts: effect" });
  route("updateActiveEffect", (e, changed, o) => { if ( "disabled" in (changed ?? {}) ) onEffect(e, o, e.active); },
    { always: true, label: "floating texts: effect" });
  // §228 : le rythme et le contenu des textes, pour la table (MJ).
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  world("floatDuration", { type: Number, default: FLOAT_DEFAULTS.duration, range: { min: 1, max: 10, step: 0.5 } });
  world("floatSpacing", { type: Number, default: FLOAT_DEFAULTS.spacing, range: { min: 0.2, max: 3, step: 0.1 } });
  world("floatDistance", { type: Number, default: FLOAT_DEFAULTS.distance, range: { min: 0.5, max: 4, step: 0.25 } });
  world("floatDirection", { type: String, default: FLOAT_DEFAULTS.direction,
    choices: { down: "DND5ECOMBAT.Reglage.floatDirection.down", up: "DND5ECOMBAT.Reglage.floatDirection.up" } });
  world("floatScale", { type: Number, default: FLOAT_DEFAULTS.scale, range: { min: 50, max: 250, step: 10 } });
  world("floatDice", { type: Boolean, default: true });
  world("floatIcons", { type: Boolean, default: true });
  for ( const [key, value] of Object.entries(FLOAT_CATEGORY_DEFAULTS) ) world(key, { type: Boolean, default: value });
  route("updateChatMessage", onUpdateMessage, { label: "visual feedback above tokens" });
  route("deleteChatMessage", message => seen.delete(message.id), { label: "visual feedback: forget" });
  route(`${MODULE_ID}.notice`, n => {
    floatNotice(n.token, n.text, n.kind);
    if ( n.kind === "heroic" ) heroicBurst(n.token).catch(() => {});
    // Issue #32 : le succès à un prix accepté — le même éclat, ambré, avec la balance.
    if ( n.kind === "atCost" ) heroicBurst(n.token, { color: 0xe0a050, icon: "icons/svg/aura.svg" }).catch(() => {});
  }, { label: "visual feedback: engine notice" });
  // §252 : l'avis d'une action d'un autre client (runtime/shared.mjs, `notice(…, { all: true })`), dessiné ici.
  CONFIG.queries[NOTICE_QUERY] = receiveNotice;
  route("createChatMessage", onCreateMessage, { label: "visual feedback: effect ending" });
}

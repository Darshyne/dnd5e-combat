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
import { FLOAT_CATEGORY_DEFAULTS, FLOAT_DEFAULTS, floatLine, floatLabel, floatFrame, floatDelays, checkKind } from "../core/float-text.mjs";
import { route } from "../runtime/router.mjs";
import { loc, NOTICE_QUERY, receiveNotice, waitForDice } from "../runtime/shared.mjs";
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

const STYLES = {
  critical: { fill: 0xffd24a, fontSize: 30 },
  miss: { fill: 0xd0d0d0, fontSize: 24 },
  cover: { fill: 0x9ecbff, fontSize: 20 },
  reaction: { fill: 0xc49bff, fontSize: 22 },
  saveSuccess: { fill: 0x8fd18f, fontSize: 22 },
  saveFail: { fill: 0xe07a6a, fontSize: 22 },
  duplicate: { fill: 0xc49bff, fontSize: 22 },
  unaffected: { fill: 0xd0d0d0, fontSize: 20 },
  prompt: { fill: 0xffb347, fontSize: 24 },     // une invite (Rebond !, Taille !, projectile 2/3)
  refused: { fill: 0xff7070, fontSize: 22 },    // un refus (Déjà visé, Trop loin)
  ended: { fill: 0x9ecbff, fontSize: 20 },      // un effet qui cesse (Renvoi, Sommeil sur dégâts)
  gain: { fill: 0x8fd18f, fontSize: 22 },       // une ressource rendue (Regain sauvage : +1 Forme sauvage)
  spend: { fill: 0xffb347, fontSize: 20 },      // la ressource dépensée pour cela (−1 emplacement niv. 2)
  strike: { fill: 0xe0453a, fontSize: 26 },     // §223 : un coup qui porte l'Attaque sournoise ou des dégâts au choix (Frappe effroyable)
  heroic: { fill: 0xffd24a, fontSize: 28 },     // §282 : l'Inspiration héroïque utilisée (un dé relancé)
  check: { fill: 0xf0e6c8, fontSize: 22 },      // §292 : un test de caractéristique, de compétence ou d'outil, sans DD connu
  checkSuccess: { fill: 0x8fd18f, fontSize: 22 },
  checkFail: { fill: 0xe07a6a, fontSize: 22 }
};

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
    case "prompt": case "refused": case "ended": case "gain": case "spend": case "strike": case "heroic":
    case "check": case "checkSuccess": case "checkFail": return f.text;
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

function layerOf() {
  if ( !layer || layer.destroyed || (layer.parent !== canvas.interface) ) {
    layer = canvas.interface.addChild(new PIXI.Container());
    layer.eventMode = "none";
    layer.zIndex = 1000;
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

/** Une ligne (pictogrammes, total du jet, texte) au-dessous ou au-dessus du token, puis son animation. */
async function drawLine(token, line, kind, options) {
  const base = STYLES[kind] ?? STYLES.prompt;
  const fontSize = Math.round(base.fontSize * options.scale);
  const { PreciseText } = foundry.canvas.containers;
  const style = PreciseText.getTextStyle({ fill: base.fill, fontSize, stroke: 0x000000, strokeThickness: 4 });
  const parts = [];
  for ( const src of [line.dieIcon ? "icons/svg/d20.svg" : null, line.icon] ) {
    const sprite = src ? await iconSprite(src, fontSize * 1.15, base.fill) : null;
    if ( sprite ) parts.push(sprite);
  }
  const label = floatLabel(line, options.modeText, options.modeJoiner);
  if ( label ) parts.push(new PreciseText(label, style));
  if ( !parts.length || !canvas?.ready || !token.visible ) return;
  // Côte à côte, centrés verticalement, la ligne entière centrée sur le token.
  const box = new PIXI.Container();
  const gap = fontSize * 0.25;
  const height = Math.max(...parts.map(p => p.height));
  let x = 0;
  for ( const part of parts ) {
    part.position.set(x, (height - part.height) / 2);
    x += part.width + gap;
    box.addChild(part);
  }
  box.pivot.set((x - gap) / 2, options.up ? height : 0);
  const { x: cx, y: cy } = token.center;
  // Sous le token en descendant (défaut) : dnd5e écrit les PV depuis le centre, en montant (actor.mjs:3557) — partir du même point
  // superposait « Sauvegarde ratée » et « -12 ». Vers le haut : depuis le haut du token.
  const start = options.up ? cy - (token.h / 2) : cy + (token.h / 2);
  const travel = (options.up ? -1 : 1) * options.distance * canvas.grid.size;
  const s = canvas.dimensions.uiScale ?? 1;
  box.position.set(cx + ((Math.random() - 0.5) * 0.1 * (x - gap)), start);
  box.alpha = 0;
  layerOf().addChild(box);
  const state = { p: 0 };
  try {
    await foundry.canvas.animation.CanvasAnimation.animate([{ parent: state, attribute: "p", from: 0, to: 1 }], {
      context: box, duration: options.duration * 1000,
      ontick: () => {
        if ( box.destroyed ) return;
        const f = floatFrame(state.p);
        box.alpha = f.alpha;
        box.scale.set(f.scale * s);
        box.y = start + (travel * f.offset);
      }
    });
  } finally {
    // Les textures des pictogrammes sont celles du cache du cœur : on ne les détruit pas.
    if ( !box.destroyed ) box.destroy({ children: true, texture: false });
  }
}

function show(feedback) {
  if ( !canvas?.ready || !game.settings.get("core", "scrollingStatusText") ) return;
  const options = floatOptions();
  const lines = [];
  for ( const f of feedback ) {
    const token = fromUuidSync(f.token)?.object;
    if ( !token?.visible || token.document.isSecret ) continue;
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
    drawLine(token, line, f.kind, options).catch(() => {});
  }, delays[i]));
}

/**
 * §282 : l'éclat de l'Inspiration héroïque utilisée, sur le token, chez chaque client (l'avis voyage par `notice(…, { all: true })`) — un
 * soleil doré qui grandit et tourne, deux anneaux qui s'élargissent, ~1,4 s. Dessiné même sans textes flottants : c'est le retour visuel
 * de l'action.
 */
export async function heroicBurst(token) {
  const placeable = (typeof token === "string") ? fromUuidSync(token)?.object : (token?.object ?? token);
  if ( !canvas?.ready || !placeable?.visible || placeable.document?.isSecret ) return;
  const gold = 0xffd24a;
  const size = Math.max(placeable.w, placeable.h);
  const box = new PIXI.Container();
  box.position.set(placeable.center.x, placeable.center.y);
  const rings = [0, 1].map(() => box.addChild(new PIXI.Graphics()));
  const texture = await foundry.canvas.loadTexture("icons/svg/sun.svg").catch(() => null);
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
 * — l'initiative exceptée) : « 15 · Athlétisme », et avec un DD connu du jet (`options.target` : un DD caché aux joueurs n'en pose pas,
 * adapter/group-roll.mjs) « 15 · Athlétisme · Réussite ». Au-dessus du token qui a lancé, après les dés 3D ; un jet privé ou aveugle ne
 * s'affiche que chez qui peut le lire (`isContentVisible`).
 */
async function showCheck(message) {
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready || ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  const data = message.system ?? {};
  const roll = message.rolls?.[0];
  if ( (data.type === "initiative") || !roll || !message.isContentVisible ) return;
  const actor = message.getAssociatedActor?.();
  const token = message.getAssociatedToken?.() ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0];
  if ( !token ) return;
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

export function registerFeedback() {
  game.settings.register(MODULE_ID, "feedbackText", { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.feedbackText.Nom", hint: "DND5ECOMBAT.Reglage.feedbackText.Aide" });
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
  }, { label: "visual feedback: engine notice" });
  // §252 : l'avis d'une action d'un autre client (runtime/shared.mjs, `notice(…, { all: true })`), dessiné ici.
  CONFIG.queries[NOTICE_QUERY] = receiveNotice;
  route("createChatMessage", onCreateMessage, { label: "visual feedback: effect ending" });
}

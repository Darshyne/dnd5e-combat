/**
 * M8 (SPEC §18.17) : Avaler / Engloutir en jeu. MJ actif.
 *  - l'effet « avalé » posé (la sauvegarde ratée du Béhir, l'action de la Grenouille) : l'agrippement par l'avaleur cesse (le
 *    texte : « no longer Grappled »), l'avalé est posé au centre de l'espace de l'avaleur, et le suit quand il marche ;
 *  - les dégâts à chaque tour, au moment que dit le texte (core/swallow.mjs) ; la Grenouille recrache après les siens ;
 *  - « s'il subit 30 dégâts ou plus en un seul tour d'une créature à l'intérieur » : sauvegarde de Constitution à la fin de ce
 *    tour, ratée → tous régurgités, À terre, au contact ;
 *  - l'avaleur meurt : les avalés sont libérés, À terre, au contact.
 * §18.21 : capacité (« une seule créature à la fois ») et cible agrippée exigées à l'effet posé ; « ne peut pas utiliser
 * Morsure tant qu'il a avalé » ; S'échapper (test de l'item, Cube gélatineux ; runtime/grapple.mjs) ; sauvegarde répétée à la
 * fin de chaque tour de l'avalé (Blob) ; un avalé sorti autrement (évasion, sauvegarde, fin de l'empoignade du Tertre) quitte
 * l'espace de l'avaleur ; engloutir en marchant (Cube, Blob) : après l'action, qui le cube traverse fait la sauvegarde.
 * §45 : le Crapaud géant, dont aucune activité ne pose l'effet « avalé » : à son action, le moteur le pose sur la créature
 * agrippée.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { swallowDamageNow, mustRegurgitateSave, enteredSpaces, fitsSize } from "../core/swallow.mjs";
import { swallowAgainst, resaveAgainst } from "../adapter/areas.mjs";
import { grappleEffectsOf, grapplerOf, actorOfEffect } from "../adapter/grapple.mjs";
import {
  swallowedBy, swallowedIn, swallowerOf, swallowedTokenOf, swallowItemOf, swallowOf, placeInside, carrySwallowed, release,
  releasing, moveOut, footprint, englishNameOf, swallowerTokenFor
} from "../adapter/swallow.mjs";
import { committedPosition } from "../adapter/turn.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";

const turnKey = combat => (combat?.started ? `${combat.id}.${combat.round}.${combat.turn}` : "hors-combat");

/** L'effet « avalé » vient d'être posé. */
async function onSwallowed(effect) {
  const by = swallowedBy(effect);
  if ( !by ) return;
  const token = swallowedTokenOf(effect);
  const swallowerToken = token ? swallowerTokenFor(effect, by, token.parent) : null;
  if ( !token || !swallowerToken ) return;
  // §18.21 : « only one creature swallowed at a time », « a target it is grappling » — sinon l'effet ne tient pas.
  const rule = by.rule;
  const others = swallowedIn(swallowerToken).filter(i => i.token !== token);
  const held = grappleEffectsOf(token.actor).some(g => (g.id !== effect.id) && (grapplerOf(g)?.uuid === by.swallower?.uuid));
  const refused = (rule.capacity && (others.length >= rule.capacity)) ? loc("Avale.Plein", { source: swallowerToken.name, n: rule.capacity })
    : ((rule.grappling && !held) ? loc("Avale.PasAgrippe", { source: swallowerToken.name, name: token.name }) : null);
  if ( refused ) {
    releasing.add(effect.uuid);
    try { await effect.delete(); }
    finally { releasing.delete(effect.uuid); }
    log(`${swallowerToken.name} n'avale pas ${token.name} : ${refused}`);
    ui.notifications.info(refused);
    return;
  }
  await effect.setFlag(MODULE_ID, "swallow", { since: turnKey(game.combat) });
  // « which is no longer Grappled » : l'empoignade de l'avaleur cesse (pas l'effet « avalé » lui-même : Tertre errant).
  for ( const grapple of grappleEffectsOf(token.actor) ) {
    if ( (grapple.id !== effect.id) && (grapplerOf(grapple)?.uuid === by.swallower?.uuid) ) await grapple.delete();
  }
  await placeInside(token, swallowerToken);
  log(`${swallowerToken.name} avale ${token.name} (${by.rule.item.name})`);
}

/**
 * Un effet « avalé » retiré autrement que par le moteur (évasion, sauvegarde répétée réussie, fin de l'empoignade du Tertre
 * errant) : la créature quitte l'espace de l'avaleur, debout.
 */
async function onRemoved(effect) {
  if ( releasing.has(effect.uuid) ) return;
  const by = swallowedBy(effect);
  if ( !by?.swallower ) return;
  const token = swallowedTokenOf(effect);
  const swallowerToken = token ? swallowerTokenFor(effect, by, token.parent) : null;
  if ( !token || !swallowerToken ) return;
  await moveOut(token, swallowerToken);
  log(`${token.name} sort de ${swallowerToken.name}`);
}

/**
 * S'échapper d'un avaleur dont l'item porte un test d'évasion (Cube gélatineux : Athlétisme contre son DD ; Tertre errant) —
 * appelé par l'action S'échapper (runtime/grapple.mjs), sur le client de celui qui s'échappe. null : pas avalé, ou rien à
 * tester ; sinon true si libre.
 */
export async function escapeSwallow(actor) {
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  const inside = token ? swallowerOf(token) : null;
  const check = inside?.rule.escape?.check;
  const dc = check?.dc?.value;
  if ( !inside || !Number.isFinite(dc) ) return null;
  const skill = Array.from(check.associated ?? [])[0] ?? "ath";
  const rolls = await actor.rollSkill({ skill, target: dc }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return false;
  const free = total >= dc;
  log(`${actor.name} ${free ? "s'échappe de" : "ne s'échappe pas de"} ${inside.token.name} (${total} contre DD ${dc})`);
  ui.notifications.info(loc(free ? "Avale.Echappe" : "Avale.Rate", { name: actor.name, source: inside.token.name }));
  if ( free ) await release(token, inside.effect, inside.token, { prone: false });
  return free;
}

/** « it can't use Bite while it has a swallowed target » — refusé, sur le client qui utilise. */
function onPreUse(activity) {
  const actor = activity?.actor;
  const rule = swallowItemOf(actor);
  if ( !rule?.forbids || (englishNameOf(activity.item).toLowerCase() !== rule.forbids.toLowerCase()) ) return;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token || !swallowedIn(token).length ) return;
  ui.notifications.warn(loc("Avale.Interdit", { source: token.name, item: activity.item.name }));
  return false;
}

/* -------------------------------------------- */
/*  Engloutir en marchant (Cube, Blob)          */
/* -------------------------------------------- */

/** Avaleur → { turn, done } : l'action d'engloutir a été utilisée ce tour-ci ; `done` : déjà visés pendant ce déplacement. */
const engulfing = new Map();

/**
 * §45 : l'avaleur dont aucune activité ne pose l'effet « avalé » (Crapaud géant : « swallows a Medium or smaller target it
 * is grappling ») vient d'utiliser son action — le moteur pose l'effet sur la créature qu'il agrippe (la première qui tient
 * sous la taille dite), et la suite est celle de tout avalement (`onSwallowed`). Rien à avaler : on le dit.
 */
async function swallowHeld(activity, rule) {
  const actor = activity.actor;
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token ) return;
  if ( rule.capacity && (swallowedIn(token).length >= rule.capacity) ) {
    return ui.notifications.info(loc("Avale.Plein", { source: token.name, n: rule.capacity }));
  }
  const held = token.parent.tokens.filter(t => (t !== token) && t.actor && !t.actor.statuses.has("dead")
    && grappleEffectsOf(t.actor).some(g => grapplerOf(g)?.uuid === actor.uuid));
  const fitting = held.filter(t => fitsSize(t.actor.system.traits?.size, rule.targetMaxSize));
  if ( !fitting.length ) {
    const text = held.length ? loc("Avale.TropGrand", { source: token.name, name: held[0].name }) : loc("Avale.Personne", { source: token.name });
    log(`${token.name} n'avale rien : ${text}`);
    return ui.notifications.info(text);
  }
  await placeItemEffect(rule.item, rule.effectId, fitting[0].actor);
}

function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") ) return;
  const activity = message.getAssociatedActivity?.();
  const rule = swallowOf(activity?.item);
  if ( rule && !rule.entryPoses && rule.effectId && (activity === rule.entry) ) return swallowHeld(activity, rule);
  if ( !rule?.moving || (activity !== rule.entry) ) return;
  const actor = activity.actor;
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token ) return;
  engulfing.set(token.uuid, { turn: turnKey(game.combat), done: new Set() });
  log(`${token.name} : ${rule.item.name} — ceux dont il traversera l'espace sauvegarderont`);
}

/** Positions du trajet, un échantillon tous les demi-cases (départ compris). */
function sampledPath(token, movement) {
  const points = [movement.origin, ...(movement.passed?.waypoints ?? []), movement.destination].filter(p => p && Number.isFinite(p.x));
  const step = Math.min(token.parent.grid.sizeX, token.parent.grid.sizeY) / 2;
  const out = [];
  for ( let i = 0; i < points.length; i++ ) {
    const a = points[i];
    const b = points[i + 1];
    out.push(footprint(token, a));
    if ( !b ) break;
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
    for ( let k = 1; k < n; k++ ) out.push(footprint(token, { x: a.x + ((b.x - a.x) * k / n), y: a.y + ((b.y - a.y) * k / n) }));
  }
  return out;
}

async function engulfAlong(token, movement) {
  const state = engulfing.get(token.uuid);
  if ( !state || (state.turn !== turnKey(game.combat)) ) return;
  const rule = swallowItemOf(token.actor);
  if ( !rule?.entry ) return;
  const inside = new Set(swallowedIn(token).map(i => i.token.id));
  const candidates = token.parent.tokens.filter(t => (t !== token) && t.actor && !t.hidden && !isObjectToken(t) && !state.done.has(t.id) && !inside.has(t.id)
    && !t.actor.statuses.has("dead") && fitsSize(t.actor.system.traits?.size, rule.maxSize));
  const ids = enteredSpaces(sampledPath(token, movement), candidates.map(t => ({ id: t.id, ...footprint(t) })));
  if ( !ids.length ) return;
  const targets = candidates.filter(t => ids.includes(t.id));
  for ( const t of targets ) state.done.add(t.id);
  log(`${token.name} traverse ${targets.map(t => t.name).join(", ")} : ${rule.item.name}`);
  await swallowAgainst(rule.entry, token, targets, "engulf", { event: "engulf", flavor: "DND5ECOMBAT.Avale.Engloutit" });
}

/** L'avaleur a marché : ses avalés suivent. */
async function onMove(token, movement, operation) {
  if ( operation?.[MODULE_ID]?.dragged ) return;
  await engulfAlong(token, movement);
  const passed = movement.passed?.waypoints ?? [];
  const from = movement.origin ?? passed[0];
  if ( !from || !swallowedIn(token).length ) return;
  const to = committedPosition(token);
  await carrySwallowed(token, to.x - from.x, to.y - from.y, (to.elevation ?? 0) - (from.elevation ?? 0));
}

/* -------------------------------------------- */
/*  Dégâts de l'intérieur : régurgiter          */
/* -------------------------------------------- */

/** Dégâts subis par un avaleur de ses avalés, par tour : `${tour}|${avaleur}` → total. */
const fromInside = new Map();

function onApplyDamage(actor, amount, options) {
  if ( !(amount > 0) ) return;
  const message = options?.originatingMessage ?? options?.origin ?? null;
  const attacker = message?.getAssociatedActor?.() ?? null;
  const token = attacker?.getActiveTokens?.(false, true)?.[0] ?? null;
  const inside = token ? swallowerOf(token) : null;
  if ( !inside || (inside.token.actor !== actor) ) return;
  const key = `${turnKey(game.combat)}|${actor.uuid}`;
  fromInside.set(key, (fromInside.get(key) ?? 0) + amount);
  log(`${actor.name} : ${amount} dégâts de ${attacker.name}, de l'intérieur (${fromInside.get(key)} ce tour-ci)`);
}

/** Fin d'un tour : chaque avaleur qui a subi assez de dégâts de l'intérieur sauvegarde, ou régurgite tout. */
async function regurgitateChecks(combat, prior) {
  const priorKey = `${combat.id}.${prior?.round}.${prior?.turn}`;
  for ( const [key, total] of Array.from(fromInside) ) {
    if ( !key.startsWith(`${priorKey}|`) ) continue;
    fromInside.delete(key);
    const actor = fromUuidSync(key.slice(priorKey.length + 1), { strict: false });
    const rule = swallowItemOf(actor);
    if ( !rule?.regurgitate || !mustRegurgitateSave(rule.threshold, total) ) continue;
    const swallowerToken = actor.token ?? actor.getActiveTokens?.(false, true)?.[0];
    const dc = rule.regurgitate.save.dc.value;
    const ability = rule.regurgitate.save.ability?.first?.() ?? Array.from(rule.regurgitate.save.ability ?? ["con"])[0];
    const rolls = await actor.rollSavingThrow({ ability, target: dc }, { configure: false });
    const result = rolls?.[0]?.total ?? rolls?.total ?? null;
    const kept = (result !== null) && (result >= dc);
    log(`${actor.name} : ${total} dégâts de l'intérieur ce tour-ci — sauvegarde ${result} contre DD ${dc} : ${kept ? "garde" : "régurgite"}`);
    if ( kept || !swallowerToken ) continue;
    for ( const { token, effect } of swallowedIn(swallowerToken) ) await release(token, effect, swallowerToken);
  }
}

/* -------------------------------------------- */
/*  Dégâts à chaque tour                        */
/* -------------------------------------------- */

async function damageAt(combat, prior, current) {
  const ended = combat.combatants.get(prior?.combatantId)?.token ?? null;
  const started = combat.combatants.get(current?.combatantId)?.token ?? null;
  const priorKey = `${combat.id}.${prior?.round}.${prior?.turn}`;
  // Le tour de l'avaleur s'achève ou commence.
  for ( const [owner, which] of [[ended, "ended"], [started, "started"]] ) {
    if ( !owner?.actor ) continue;
    const rule = swallowItemOf(owner.actor);
    if ( !rule?.damage ) continue;
    const inside = swallowedIn(owner).filter(({ effect }) => swallowDamageNow(rule.damageAt,
      { [which]: true, sameTurn: effect.getFlag(MODULE_ID, "swallow")?.since === priorKey }));
    if ( !inside.length ) continue;
    log(`${owner.name} : ${rule.item.name} — ${inside.map(i => i.token.name).join(", ")}`);
    await swallowAgainst(rule.damage, owner, inside.map(i => i.token), rule.damageAt);
  }
  // Le tour d'un avalé s'achève : « repeats the save at the end of each of its turns » (Blob) — réussie, l'effet tombe
  // (runtime/engine.mjs, brique resave) et la créature sort (onRemoved).
  const out = ended ? swallowerOf(ended) : null;
  if ( out?.rule.repeatsSave && out.rule.entry ) {
    log(`${ended.name}, dans ${out.token.name} : sauvegarde répétée`);
    await resaveAgainst(out.effect, out.rule.entry, ended, "endOfTurn");
  }
  // Le tour d'un avalé commence (Kraken, Blob, Tertre : « at the start of each of its turns »).
  const holder = started ? swallowerOf(started) : null;
  if ( holder?.rule.damage && swallowDamageNow(holder.rule.damageAt, { targetStarted: true }) ) {
    log(`${started.name} commence son tour dans ${holder.token.name} : ${holder.rule.item.name}`);
    await swallowAgainst(holder.rule.damage, holder.token, [started], holder.rule.damageAt);
  }
}

/**
 * La Grenouille : « If that damage doesn't kill it, the frog disgorges it ». Le Cube : « Success: … the target moves to an
 * unoccupied space within 5 feet » — qui a réussi et se tient dans son espace en sort.
 */
async function onResolution(resolution) {
  if ( resolution.step !== STEPS.DONE ) return;
  const tick = game.messages.get(resolution.carrier)?.getFlag(MODULE_ID, "areaTick");
  if ( tick?.event === "engulf" ) {
    const swallowerToken = fromUuidSync(tick.source, { strict: false });
    for ( const t of resolution.targets ) {
      if ( t.save?.success !== true ) continue;
      const token = fromUuidSync(t.token, { strict: false });
      if ( token ) await moveOut(token, swallowerToken);
    }
    return;
  }
  if ( (tick?.event !== "swallow") || (tick.moment !== "ownerEndOnce") ) return;
  const swallowerToken = fromUuidSync(tick.source, { strict: false });
  for ( const { token, effect } of swallowedIn(swallowerToken) ) {
    if ( (token.actor?.system.attributes?.hp?.value ?? 0) <= 0 ) continue;
    await release(token, effect, swallowerToken);
    log(`${swallowerToken.name} recrache ${token.name}`);
  }
}

/** L'avaleur meurt : ses avalés sont libérés. */
async function onDeath(effect) {
  if ( !effect.statuses?.has("dead") ) return;
  const actor = actorOfEffect(effect);
  const swallowerToken = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  for ( const { token, effect: swallowed } of swallowedIn(swallowerToken) ) {
    await release(token, swallowed, swallowerToken);
    log(`${actor.name} meurt : ${token.name} est libéré`);
  }
}

export function registerSwallow() {
  const executor = { executor: true };
  route("createActiveEffect", effect => Promise.all([onSwallowed(effect), onDeath(effect)]), { ...executor, label: "avaler : effet non suivi" });
  route("deleteActiveEffect", onRemoved, { ...executor, label: "avaler : l'avalé ne sort pas" });
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "avaler : Morsure non refusée" });
  route("createChatMessage", onUsage, { ...executor, label: "avaler / engloutir : action non suivie" });
  route("moveToken", onMove, { ...executor, label: "avaler : les avalés ne suivent pas" });
  route("dnd5e.applyDamage", onApplyDamage, { ...executor, label: "avaler : dégâts de l'intérieur non comptés" });
  route("combatTurnChange", async (combat, prior, current) => {
    await regurgitateChecks(combat, prior);
    await damageAt(combat, prior, current);
  }, { ...executor, label: "avaler : tour non traité" });
  route(`${MODULE_ID}.resolution`, onResolution, { ...executor, label: "avaler : la grenouille ne recrache pas" });
}

/**
 * Fins de sorts (SPEC §42.2) : ce qui suit la fin d'un effet.
 *
 *  - `effectThen` (MJ actif) : quand un effet d'item cesse sur une créature — durée écoulée, concentration rompue, dissipation,
 *    retrait à la main —, un autre effet du même item y est posé. Hâte : « quand le sort prend fin, la cible est Neutralisée et sa
 *    Vitesse est de 0 jusqu'à la fin de son prochain tour » (l'effet « Lethargy », que `effectEnds` fait tomber à la fin du
 *    prochain tour du porteur, runtime/cantrips.mjs).
 *  - §258 `endsWhen` (MJ actif) : les fins génériques relevées par l'audit CAT / CPR (core/endings.mjs) — armure enfilée, porteur et
 *    lanceur trop éloignés, 0 PV, et la concentration qui tombe quand l'utilisation n'a affecté personne (réglage `endUnaffected`).
 * Les autres fins vivent avec leur brique : sauvegarde répétée et dégâts au tour du porteur (runtime/triggers.mjs), effet rompu
 * par ce que fait son porteur (`breaksOn`, runtime/breaks.mjs), fin à un tour précis (`effectEnds`, runtime/cantrips.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { damagedByOriginSide } from "../core/triggers.mjs";
import { areEnemies, sideOf } from "../adapter/factions.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { ARMOR_WEIGHTS, armorEnds, nobodyAffected, tooFarApart } from "../core/endings.mjs";
import { contentOf } from "../adapter/content.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { potionOfCast } from "../adapter/potions.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, locEsc, notice, say } from "./shared.mjs";

export const END_UNAFFECTED_SETTING = "endUnaffected";

async function onDeleteEffect(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const item = originItemOf(effect);
  // §53 : le sort qu'une potion a fait lancer n'a pas de suite (Rapidité : « sans la vague de léthargie » de Hâte).
  const rules = (item && !potionOfCast(item)) ? contentOf(item).entry?.effectThen : null;
  if ( !rules ) return;
  const key = Object.keys(rules).find(id => comesFromItemEffect(effect, id));
  if ( !key ) return;
  // Une créature à 0 PV n'a plus rien à subir ; un acteur de token supprimé avec son token non plus.
  if ( (actor.system?.attributes?.hp?.value ?? 0) <= 0 ) return;
  if ( actor.isToken ? !actor.token?.parent?.tokens?.has(actor.token.id) : !game.actors.has(actor.id) ) return;
  return enqueue(`effectThen:${actor.uuid}`, async () => {
    const placed = await placeItemEffect(item, rules[key], actor, { scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0 });
    if ( placed ) log(`${item.name}: "${effect.name}" ends on ${actor.name}, "${placed.name}" applied`);
  });
}

/* -------------------------------------------- */
/*  §258 : fins génériques (`endsWhen`)          */
/* -------------------------------------------- */

const rulesOf = item => (item ? contentOf(item).entry?.endsWhen ?? null : null);

/** Les acteurs d'une scène : ceux du monde (liés) et ceux des tokens non liés. */
const actorsOf = scene => new Set([...game.actors, ...(scene?.tokens ?? []).filter(t => !t.actorLink && t.actor).map(t => t.actor)]);

/**
 * Les effets portés qu'une règle `endsWhen` de leur item d'origine peut faire cesser (la concentration du lanceur exceptée : elle tombe
 * par le sort, pas comme un effet porté).
 * @returns {{actor: Actor, effect: ActiveEffect, item: Item, rule: object}[]}
 */
function endingEffects(actors) {
  const out = [];
  for ( const actor of actors ) {
    for ( const effect of actor?.effects ?? [] ) {
      if ( effect.statuses?.has?.("concentrating") ) continue;
      const item = originItemOf(effect);
      const rule = rulesOf(item);
      if ( rule ) out.push({ actor, effect, item, rule });
    }
  }
  return out;
}

/** Le token d'un acteur sur cette scène, ou null. */
function tokenIn(actor, scene) {
  if ( !actor || !scene ) return null;
  if ( actor.isToken ) return (actor.token?.parent === scene) ? actor.token : null;
  return scene.tokens.find(t => t.actorLink && (t.actorId === actor.id)) ?? null;
}

/**
 * Met fin à l'effet — ou, `spell`, au sort entier : sa concentration (dnd5e retire alors les effets qui en dépendent), sinon ses
 * effets sur chaque créature de la scène. Une carte de chat le dit à toute la table.
 * @param {{actor, effect, item, rule}} entry
 * @param {"armor"|"apart"|"zeroHp"} reason
 * @param {Set<string>} done  Les sorts déjà terminés pendant ce passage.
 */
async function endEntry({ actor, effect, item, rule }, reason, scene, done) {
  if ( done.has(item.uuid) || done.has(effect.uuid) ) return;
  if ( rule.spell ) {
    done.add(item.uuid);
    const concentration = concentrationOn(item);
    if ( concentration ) await concentration.delete();
    else {
      for ( const other of endingEffects(actorsOf(scene)).filter(e => e.item === item) ) {
        if ( other.actor.effects.has(other.effect.id) ) await other.effect.delete();
      }
    }
  }
  else {
    done.add(effect.uuid);
    if ( !actor.effects.has(effect.id) ) return;
    await effect.delete();
  }
  log(`${item.name}: ends${rule.spell ? "" : ` on ${actor.name}`} (${reason})`);
  // §252 : un texte flottant chez chaque client, et un son.
  const token = tokenIn(actor, scene);
  if ( token ) notice(token, { key: "Retour.FinEffet", data: { item: item.name } }, "ended", { all: true, action: "spellEnds", outcome: "success" });
  await say({ actor: item.actor ?? actor }, locEsc(`FinGenerique.${reason}`, { item: item.name, name: actor.name }),
    { ended: { item: item.uuid, actor: actor.uuid, reason } });
}

/** L'armure enfilée : Armure du mage (toute armure), Rage (armure lourde). */
async function onUpdateItem(item, changes) {
  if ( (item.type !== "equipment") || (foundry.utils.getProperty(changes, "system.equipped") !== true) ) return;
  const weight = item.system?.type?.value;
  const actor = item.parent;
  if ( !ARMOR_WEIGHTS.includes(weight) || (actor?.documentName !== "Actor") ) return;
  const entries = endingEffects([actor]).filter(e => e.rule.armor && armorEnds(e.rule.armor, weight));
  if ( !entries.length ) return;
  const scene = tokenIn(actor, canvas?.scene) ? canvas.scene : (actor.getActiveTokens?.(false, true)?.[0]?.parent ?? canvas?.scene);
  return enqueue(`endsWhen:${actor.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) await endEntry(e, "armor", scene, done);
  });
}

/** §270 : un allié du lanceur (pas lui) vient de blesser le porteur (Duel forcé) — l'auteur noté par runtime/triggers.mjs (`damagedBy`). */
function hurtByCasterAlly(actor, caster, scene) {
  const noted = actor.getFlag(MODULE_ID, "damagedBy");
  if ( !noted?.uuid || ((Date.now() - (noted.at ?? 0)) > 10000) ) return false;
  const damager = fromUuidSync(noted.uuid, { strict: false });
  if ( !damager || !caster || (damager === caster) ) return false;
  const dt = tokenIn(damager, scene), ct = tokenIn(caster, scene);
  return damagedByOriginSide({ damager: damager.uuid, origin: caster.uuid, damagerDisposition: dt?.disposition ?? null,
    originDisposition: ct?.disposition ?? null, damagerSide: dt ? sideOf(dt) : null, originSide: ct ? sideOf(ct) : null });
}

/** 0 PV : le porteur, ou le lanceur dont les effets courent sur d'autres (Lien de garde) ; §270 : blessé par un allié du lanceur. */
async function onUpdateActor(actor, changes) {
  const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
  if ( hp === undefined ) return;
  if ( hp > 0 ) return onHurt(actor);
  const scene = actor.isToken ? actor.token?.parent : (actor.getActiveTokens?.(false, true)?.[0]?.parent ?? canvas?.scene);
  const entries = endingEffects(actorsOf(scene)).filter(e => e.rule.zeroHp && ((e.actor === actor) || (e.item.actor === actor)));
  if ( !entries.length ) return;
  return enqueue(`endsWhen:${actor.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) await endEntry(e, "zeroHp", scene, done);
  });
}

async function onHurt(actor) {
  const scene = actor.isToken ? actor.token?.parent : (actor.getActiveTokens?.(false, true)?.[0]?.parent ?? canvas?.scene);
  const entries = endingEffects([actor]).filter(e => e.rule.allyDamages && hurtByCasterAlly(actor, e.item.actor, scene));
  if ( !entries.length ) return;
  return enqueue(`endsWhen:${actor.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) await endEntry(e, "allyDamages", scene, done);
  });
}

/**
 * §270 : le lanceur vient d'utiliser une activité qui vise une autre créature que le porteur — un jet d'attaque contre elle, ou un sort sur
 * un ennemi (Duel forcé : « si vous effectuez un jet d'attaque contre une créature autre que la cible, si vous lancez un sort sur un
 * ennemi autre que la cible »). Le message d'utilisation porte ses cibles.
 */
async function onUsage(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  const caster = activity?.actor;
  const targets = (message.system?.targets ?? []).map(t => fromUuidSync(t.token ?? "", { strict: false })).filter(Boolean);
  if ( !caster || !targets.length ) return;
  const scene = targets[0].parent;
  const entries = endingEffects(actorsOf(scene)).filter(e => e.rule.casterTargetsOther && (e.item.actor === caster) && (e.item !== activity.item));
  if ( !entries.length ) return;
  const casterToken = tokenIn(caster, scene);
  return enqueue(`endsWhen:${caster.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) {
      const bearer = tokenIn(e.actor, scene);
      const others = targets.filter(t => t !== bearer);
      const breaks = (activity.type === "attack") ? others.length > 0
        : (isSpellCast(activity.item) && others.some(t => casterToken && areEnemies(casterToken, t)));
      if ( breaks ) await endEntry(e, "casterTargetsOther", scene, done);
    }
  });
}

/** Porteur et lanceur sont-ils trop éloignés ? Lanceur absent de la scène : on ne juge pas. */
function apartTooFar({ actor, item, rule }, scene) {
  const bearer = tokenIn(actor, scene);
  const caster = tokenIn(item.actor, scene);
  if ( !bearer || !caster || (bearer === caster) ) return false;
  const { value, units } = distanceBetween(bearer, caster);
  return tooFarApart(value, lengthIn(rule.apart.distance, rule.apart.units, units));
}

/** Un token a bougé : les liens à distance qui le concernent, porteur ou lanceur (`apart.at` : "move", par défaut). */
async function onMoveToken(tokenDoc) {
  const scene = tokenDoc.parent;
  const moved = tokenDoc.actor;
  if ( !moved ) return;
  const entries = endingEffects(actorsOf(scene)).filter(e => e.rule.apart && ((e.rule.apart.at ?? "move") === "move")
    && ((e.actor === moved) || (e.item.actor === moved)));
  if ( !entries.length ) return;
  return enqueue(`endsWhen:apart:${scene.id}`, async () => {
    const done = new Set();
    for ( const e of entries ) if ( apartTooFar(e, scene) ) await endEntry(e, "apart", scene, done);
  });
}

/** La fin du tour du lanceur : les liens jugés à ce moment (`apart.at: "casterTurnEnd"`, Duel forcé). */
async function onTurnChange(combat, prior) {
  const caster = combat.combatants.get(prior?.combatantId)?.actor;
  const scene = combat.scene ?? canvas?.scene;
  if ( !caster || !scene ) return;
  const entries = endingEffects(actorsOf(scene)).filter(e => (e.rule.apart?.at === "casterTurnEnd") && (e.item.actor === caster));
  if ( !entries.length ) return;
  return enqueue(`endsWhen:apart:${scene.id}`, async () => {
    const done = new Set();
    for ( const e of entries ) if ( apartTooFar(e, scene) ) await endEntry(e, "apart", scene, done);
  });
}

/** L'utilisation est résolue et n'a affecté personne : la concentration du sort tombe (réglage `endUnaffected`). */
async function onResolution(resolution) {
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) ) return;
  if ( !game.settings.get(MODULE_ID, END_UNAFFECTED_SETTING) ) return;
  const item = fromUuidSync(resolution.activity ?? "", { strict: false })?.item;
  const rule = rulesOf(item);
  if ( !rule?.unaffected || !nobodyAffected(resolution, rule.unaffected) ) return;
  const concentration = concentrationOn(item);
  if ( !concentration ) return;
  await concentration.delete();
  log(`${item.name}: nobody affected, concentration ends`);
  const caster = item.actor.isToken ? item.actor.token : item.actor.getActiveTokens?.(false, true)?.[0];
  if ( caster ) notice(caster, { key: "Retour.FinEffet", data: { item: item.name } }, "ended", { all: true, action: "spellEnds", outcome: "success" });
  await say({ actor: item.actor }, locEsc("FinGenerique.unaffected", { item: item.name, name: item.actor.name }),
    { ended: { item: item.uuid, actor: item.actor.uuid, reason: "unaffected" } });
}

export function registerEndings() {
  game.settings.register(MODULE_ID, END_UNAFFECTED_SETTING, {
    name: `DND5ECOMBAT.Reglage.${END_UNAFFECTED_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${END_UNAFFECTED_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  route("deleteActiveEffect", onDeleteEffect, { executor: true, label: "effect end: next effect not applied" });
  route("updateItem", onUpdateItem, { executor: true, label: "effect end on armor: not played" });
  route("updateActor", onUpdateActor, { executor: true, label: "effect end at 0 HP: not played" });
  route("createChatMessage", onUsage, { executor: true, label: "effect end when the caster targets another creature: not judged" });
  route("moveToken", onMoveToken, { executor: true, label: "effect end by distance: not judged" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "effect end by distance at turn end: not judged" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`endsWhen:resolution:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "concentration end when nobody is affected: not played" });
}

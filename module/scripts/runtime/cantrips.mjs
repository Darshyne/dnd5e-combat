/**
 * Tours de magie (SPEC §23) : ce que les données de dnd5e ne disent pas.
 *
 *  - `effectEnds` (MJ actif) : un effet d'item tombe au début du prochain tour du lanceur (Rayon de givre), à la fin de son
 *    prochain tour (Contact glacial, Éclat mental, Moquerie cruelle), au début du prochain tour du porteur (Poigne électrique)
 *    ou à la fin de son prochain tour (léthargie de Hâte, §42.2).
 *    À sa pose, le moteur note le tour et lui donne une minute de durée, pour que l'expiration de dnd5e (« 1 round », au début d'un
 *    tour quelconque) ne passe pas avant.
 *  - `blocksHealing` (client qui applique) : le porteur d'un effet de l'item ne regagne pas de PV (Contact glacial).
 *  - `byWounds` (client de l'auteur) : Glas lance les dés de la bonne activité — d12 contre une cible blessée, d8 sinon ; et le
 *    choix « cible indemne / cible blessée » que dnd5e ouvre pour un item à deux activités n'est plus posé (§41.1 ;
 *    runtime/activity-choice.mjs, qui lit `byWounds`).
 *  - `oneAttack` (MJ actif) : l'enchantement de Frappe assurée tombe après l'attaque de l'arme. L'attaque elle-même est offerte par
 *    l'interface dès l'enchantement posé (ui/pointer.mjs).
 * Éclat mental (`breaksOn: ["save"]`) : runtime/breaks.mjs ; Poigne électrique (`noOpportunityAttacks`) : runtime/reactions.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf, entryOfIdentifier } from "../adapter/content.mjs";
import { potionOfCast } from "../adapter/potions.mjs";
import { durationSeconds } from "../core/rolled-duration.mjs";
import { durationAtLevel } from "../core/durations.mjs";
import { reducesSpeed, withoutSpeedReductions } from "../core/speed-floor.mjs";
import { originItemOf, isWounded } from "../adapter/facts.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { currentTurnKey, combatSceneActors, turnKeyAt } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

/** La règle `effectEnds` qui vaut pour cet effet (posé par un item), ou null. */
function endRuleOf(effect) {
  const item = originItemOf(effect);
  const rules = item ? contentOf(item).entry?.effectEnds : null;
  if ( !rules ) return null;
  // §157 : `status:<id>` — un état posé par l'item sans effet à lui (étape `status` : Étourdi du Châtiment de stupeur).
  const key = Object.keys(rules).find(id => id.startsWith("status:") ? effect.statuses?.has?.(id.slice(7)) : comesFromItemEffect(effect, id));
  return key ? { when: rules[key], caster: item.actor ?? null } : null;
}

/**
 * §42.2 : le contenu fait-il tomber lui-même cet effet au tour de son porteur (`remove` à startOfTurn / endOfTurn : les dégâts
 * différés de la Flèche acide de Melf, de la Sphère de vitriol) ? Leur durée d'« 1 tour » expirerait au changement de tour même où
 * les dégâts doivent tomber — et un effet expiré en combat n'est pas supprimé par dnd5e mais suspendu (`isSuppressed`,
 * client/documents/active-effect.mjs:192 ; documents/active-effect.mjs:804), donc ignoré : vu en jeu le 2026-10-01.
 */
function removedAtTurn(effect) {
  const item = originItemOf(effect);
  if ( !item ) return false;
  return (contentOf(item).entry?.triggers ?? []).some(d => (d.via === "effect")
    && [].concat(d.on ?? []).some(m => ["startOfTurn", "endOfTurn"].includes(m))
    && (!d.fromEffect || comesFromItemEffect(effect, d.fromEffect))
    && (d.do ?? []).some(s => s.type === "remove"));
}

/** O9h (§363) : les durées tirées par utilisation (`{ formula, units }`), pour que toutes les cibles d'un même usage aient la même. */
const drawn = new Map();

/** La durée de cet effet selon la règle `effectDurations` — tirée une fois par utilisation (message d'origine) et par item. */
function drawnDuration(effect, item, rule) {
  if ( Number.isFinite(rule.seconds) ) return rule.seconds;
  const now = Date.now();
  for ( const [k, v] of drawn ) if ( now - v.at > 30000 ) drawn.delete(k);
  const key = `${item.uuid}|${effect.system?.origin?.message ?? effect.origin ?? ""}`;
  if ( !drawn.has(key) ) {
    const seconds = durationSeconds(rule);
    drawn.set(key, { seconds, at: now });
    if ( seconds ) log(`${item.name}: duration ${rule.formula} ${rule.units} → ${seconds} s`);
  }
  return drawn.get(key).seconds;
}

/** O9h (§363) : un effet du sort qu'un objet a fait lancer (copie `cachedFor`) dure ce que l'objet déclare (`castDuration`). */
export function castDurationOf(spell) {
  const potion = spell ? potionOfCast(spell) : null;
  return potion?.identifier ? (entryOfIdentifier(potion.identifier)?.castDuration?.seconds ?? null) : null;
}

/**
 * Avant la pose, sur le client qui crée l'effet : le tour noté, une minute de durée (l'heure de fin est celle du moteur). Dans les
 * données de création, sans écriture : une mise à jour juste après croisait la réécriture d'un token non lié (« A parent Document
 * provided to the database operation must be a Document instance », vu le 2026-09-28).
 */
function onPreCreateEffect(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return true;
  // §295 : `effectDurations` — la durée que la règle donne à cet effet de l'item (Présence intimidante : une minute, la donnée dit un
  // round), en combat comme hors combat. Une règle `effectEnds` du même effet, plus bas, garde la main sur sa fin.
  const item = originItemOf(effect);
  const durations = item ? contentOf(item).entry?.effectDurations : null;
  const wanted = durations ? Object.entries(durations).find(([id]) => comesFromItemEffect(effect, id))?.[1] : null;
  const seconds = wanted ? drawnDuration(effect, item, wanted) : castDurationOf(item);
  if ( seconds ) effect.updateSource({ duration: { value: seconds, units: "seconds", expiry: null } });
  // §403 : `keepsSpeed` — Liberté de mouvement : « sa Vitesse ne peut pas être réduite par la magie ». Un effet magique (sort, objet
  // magique) posé sur un porteur protégé arrive sans ses réductions de Vitesse (Rayon de givre, Lenteur, Danse irrésistible).
  const changes = effect.system?.changes ?? effect.changes ?? [];
  if ( changes.some(reducesSpeed) && magicalOrigin(item) && speedKept(effect.parent) ) {
    effect.updateSource({ "system.changes": withoutSpeedReductions(changes) });
    log(`${effect.parent.name}: ${effect.name} cannot reduce its Speed (magic)`);
  }
  // §403 : `durationByLevel` — la durée selon l'emplacement de lancement (Malédiction), sur les effets posés et sur la concentration.
  const byLevel = item ? contentOf(item).entry?.durationByLevel : null;
  if ( byLevel ) {
    const tier = durationAtLevel(byLevel, (Number(item.system?.level) || 0) + (Number(effect.flags?.dnd5e?.scaling) || 0));
    if ( tier ) {
      effect.updateSource({ duration: { value: tier.seconds, units: tier.seconds ? "seconds" : "", expiry: null } });
      log(`${item.name}: ${effect.name} lasts ${tier.seconds ? `${tier.seconds} s` : "until dispelled"} (cast level)`);
    }
  }
  if ( !game.combat?.started ) return true;
  if ( !endRuleOf(effect) && !removedAtTurn(effect) ) return true;
  effect.updateSource({ [`flags.${MODULE_ID}.placedOn`]: currentTurnKey(), duration: { value: 60, units: "seconds", expiry: null } });
  return true;
}

async function expire(combat, prior, current) {
  const priorActor = combat.combatants.get(prior?.combatantId)?.actor ?? null;
  const currentActor = combat.combatants.get(current?.combatantId)?.actor ?? null;
  const priorKey = turnKeyAt(combat, prior);
  for ( const actor of combatSceneActors(combat) ) {
    const gone = actor.effects.filter(effect => {
      const rule = endRuleOf(effect);
      if ( !rule ) return false;
      const caster = rule.caster?.uuid ?? null;
      if ( rule.when === "casterTurnStart" ) return !!currentActor && (currentActor.uuid === caster);
      if ( rule.when === "bearerTurnStart" ) return !!currentActor && (currentActor.uuid === actor.uuid);
      // §42.2 : « jusqu'à la fin de son prochain tour » (léthargie de Hâte) : pas la fin du tour où l'effet a été posé.
      if ( rule.when === "bearerTurnEnd" ) return !!priorActor && (priorActor.uuid === actor.uuid) && (effect.getFlag(MODULE_ID, "placedOn") !== priorKey);
      // « Jusqu'à la fin de votre prochain tour » : pas la fin du tour où il a été posé.
      return !!priorActor && (priorActor.uuid === caster) && (effect.getFlag(MODULE_ID, "placedOn") !== priorKey);
    });
    const ids = gone.map(e => e.id).filter(id => actor.effects.has(id));
    if ( !ids.length ) continue;
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`${actor.name}: ${gone.map(e => e.name).join(", ")} ends (turn)`);
  }
}

/* -------------------------------------------- */

/** Un sort, ou un objet à la propriété Magique. */
function magicalOrigin(item) {
  return !!item && ((item.type === "spell") || (item.system?.properties?.has?.("mgc") === true));
}

/** §403 : l'acteur porte-t-il un effet d'un item `keepsSpeed` (Liberté de mouvement) ? */
function speedKept(actor) {
  return (actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed && (contentOf(originItemOf(e)).entry?.keepsSpeed === true));
}

/**
 * §403 : `durationByLevel` — à l'emplacement où le sort ne demande plus de Concentration (Malédiction au niveau 5+), dnd5e ne la
 * commence pas : `usageConfig.concentration.begin` est lu juste après ce hook (activity/mixin.mjs:338, puis 278).
 */
function onPreActivityConsumption(activity, usageConfig) {
  const rule = activity?.item ? contentOf(activity.item).entry?.durationByLevel : null;
  if ( !rule || !usageConfig?.concentration?.begin ) return true;
  const level = (Number(activity.item.system?.level) || 0) + (Number(usageConfig.scaling) || 0);
  if ( durationAtLevel(rule, level)?.concentration === false ) {
    usageConfig.concentration.begin = false;
    log(`${activity.item.name}: cast at level ${level}, no Concentration`);
  }
  return true;
}

/** Contact glacial : pas de PV regagnés tant que l'effet tient. */
function onPreApplyDamage(actor, amount, updates) {
  if ( !(amount < 0) || !actor?.effects ) return true;
  // §334 : `blocksHealing` — tous les effets de l'item, ou ceux de la liste (Rayon énervant : son Empoisonné seul).
  const blocked = actor.effects.some(e => {
    if ( e.disabled || e.isSuppressed ) return false;
    const rule = contentOf(originItemOf(e)).entry?.blocksHealing;
    return (rule === true) || (Array.isArray(rule) && rule.some(id => comesFromItemEffect(e, id)));
  });
  if ( !blocked ) return true;
  const hp = actor.system.attributes?.hp?.value;
  if ( Number.isFinite(hp) && (updates["system.attributes.hp.value"] > hp) ) {
    updates["system.attributes.hp.value"] = hp;
    log(`${actor.name}: cannot regain Hit Points`);
  }
  return true;
}

/** Glas : les dés de l'activité qui convient à la cible (blessée : `wounded`, indemne : `healthy`). Client de l'auteur. */
function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const rule = activity?.item ? contentOf(activity.item).entry?.byWounds : null;
  if ( !rule || ![rule.healthy, rule.wounded].includes(activity.id) || !config.rolls?.length ) return true;
  const described = foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [];
  const actors = described.length ? described.map(t => fromUuidSync(t.token ?? "", { strict: false })?.actor).filter(Boolean)
    : Array.from(game.user.targets).map(t => t.actor).filter(Boolean);
  if ( !actors.length ) return true;
  const wanted = actors.every(isWounded) ? rule.wounded : rule.healthy;
  if ( wanted === activity.id ) return true;
  const faceOf = a => Number(a?.damage?.parts?.[0]?.denomination) || null;
  const from = faceOf(activity);
  const to = faceOf(activity.item.system.activities.get(wanted));
  if ( !from || !to ) return true;
  const base = config.rolls[0];
  base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? String(p).replace(new RegExp(`d${from}(?!\\d)`, "g"), `d${to}`) : p));
  log(`${activity.item.name}: target ${wanted === rule.wounded ? "wounded" : "unhurt"}, d${from} → d${to}`);
  return true;
}

/**
 * Frappe assurée : l'enchantement ne tombe qu'après l'attaque (ci-dessous). Hors combat, V14 marque « expirée » sa durée d'« 1 tour »
 * (`duration.expired`), et dnd5e supprime alors l'effet (documents/active-effect.mjs:804) — vu le 2026-09-28, avant qu'on ait pu
 * attaquer. Cette mise à jour-là est refusée.
 */
function onPreUpdateEffect(effect, changes) {
  if ( foundry.utils.getProperty(changes, "duration.expired") !== true ) return true;
  if ( (effect.parent?.documentName !== "Item") || (contentOf(originItemOf(effect)).entry?.oneAttack !== true) ) return true;
  return false;
}

/** Frappe assurée : après l'attaque de l'arme enchantée, l'enchantement tombe. MJ actif. */
async function onResolution(resolution) {
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) || !resolution.plan?.attack ) return;
  const weapon = fromUuidSync(resolution.activity, { strict: false })?.item;
  if ( !weapon?.effects ) return;
  const once = weapon.effects.filter(e => contentOf(originItemOf(e)).entry?.oneAttack === true);
  const ids = once.map(e => e.id).filter(id => weapon.effects.has(id));
  if ( !ids.length ) return;
  await weapon.deleteEmbeddedDocuments("ActiveEffect", ids);
  log(`${weapon.name}: ${once.map(e => e.name).join(", ")} drops after the attack`);
}

export function registerCantrips() {
  route("preCreateActiveEffect", onPreCreateEffect, { cancellable: true, label: "spell effect end not recorded" });
  route("dnd5e.preActivityConsumption", onPreActivityConsumption, { cancellable: true, label: "spell without Concentration at a higher level" });
  route("preUpdateActiveEffect", onPreUpdateEffect, { cancellable: true, label: "True Strike: enchantment expired too early" });
  route("combatTurnChange", (combat, prior, current) => enqueue("cantrips:ends", () => expire(combat, prior, current)),
    { executor: true, label: "spell effect end not played" });
  route("dnd5e.preApplyDamage", onPreApplyDamage, { label: "healing blocked" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "Toll the Dead: target's dice" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`oneAttack:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "attack enchantment not removed" });
}

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
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, isWounded } from "../adapter/facts.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { currentTurnKey } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

/** La règle `effectEnds` qui vaut pour cet effet (posé par un item), ou null. */
function endRuleOf(effect) {
  const item = originItemOf(effect);
  const rules = item ? contentOf(item).entry?.effectEnds : null;
  if ( !rules ) return null;
  const key = Object.keys(rules).find(id => comesFromItemEffect(effect, id));
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

/**
 * Avant la pose, sur le client qui crée l'effet : le tour noté, une minute de durée (l'heure de fin est celle du moteur). Dans les
 * données de création, sans écriture : une mise à jour juste après croisait la réécriture d'un token non lié (« A parent Document
 * provided to the database operation must be a Document instance », vu le 2026-09-28).
 */
function onPreCreateEffect(effect) {
  if ( (effect.parent?.documentName !== "Actor") || !game.combat?.started ) return true;
  if ( !endRuleOf(effect) && !removedAtTurn(effect) ) return true;
  effect.updateSource({ [`flags.${MODULE_ID}.placedOn`]: currentTurnKey(), duration: { value: 60, units: "seconds", expiry: null } });
  return true;
}

/** Les acteurs de la scène du combat, une fois chacun. */
const actorsOf = combat => [...new Set(((combat?.scene ?? canvas.scene)?.tokens ?? []).map(t => t.actor).filter(Boolean))];

async function expire(combat, prior, current) {
  const priorActor = combat.combatants.get(prior?.combatantId)?.actor ?? null;
  const currentActor = combat.combatants.get(current?.combatantId)?.actor ?? null;
  const priorKey = prior ? `${combat.id}.${prior.round}.${prior.turn}` : null;
  for ( const actor of actorsOf(combat) ) {
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
    log(`${actor.name} : ${gone.map(e => e.name).join(", ")} prend fin (tour)`);
  }
}

/* -------------------------------------------- */

/** Contact glacial : pas de PV regagnés tant que l'effet tient. */
function onPreApplyDamage(actor, amount, updates) {
  if ( !(amount < 0) || !actor?.effects ) return true;
  const blocked = actor.effects.some(e => !e.disabled && !e.isSuppressed && (contentOf(originItemOf(e)).entry?.blocksHealing === true));
  if ( !blocked ) return true;
  const hp = actor.system.attributes?.hp?.value;
  if ( Number.isFinite(hp) && (updates["system.attributes.hp.value"] > hp) ) {
    updates["system.attributes.hp.value"] = hp;
    log(`${actor.name} : ne peut pas regagner de points de vie`);
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
  log(`${activity.item.name} : cible ${wanted === rule.wounded ? "blessée" : "indemne"}, d${from} → d${to}`);
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
  log(`${weapon.name} : ${once.map(e => e.name).join(", ")} tombe après l'attaque`);
}

export function registerCantrips() {
  route("preCreateActiveEffect", onPreCreateEffect, { cancellable: true, label: "fin d'effet de sort non notée" });
  route("preUpdateActiveEffect", onPreUpdateEffect, { cancellable: true, label: "Frappe assurée : enchantement expiré trop tôt" });
  route("combatTurnChange", (combat, prior, current) => enqueue("cantrips:ends", () => expire(combat, prior, current)),
    { executor: true, label: "fin d'effet de sort non jouée" });
  route("dnd5e.preApplyDamage", onPreApplyDamage, { label: "soins bloqués" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "Glas : dés de la cible" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`oneAttack:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "enchantement d'une attaque non retiré" });
}

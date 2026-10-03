/**
 * Le registre de déclencheurs vu depuis dnd5e 6.0 : ce que les items d'un acteur déclarent,
 * toutes couches de contenu confondues (adapter/content.mjs), sous forme canonique et avec leur
 * provenance. Les faits sont dans adapter/facts.mjs.
 */

import { normalize, select, stepsOf } from "../core/triggers.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { originItemOf, factsFor, comesFromItemEffect } from "./facts.mjs";
import { hasReactionAdvantage, takeReactionAdvantage } from "./marks.mjs";
import { markModifiers } from "./mastery.mjs";
export { factsFor, originItemOf, tokenOf, comesFromItemEffect } from "./facts.mjs";

/**
 * Ce qu'un item déclare. Chaque déclaration sait d'où elle vient (item, activité de réaction).
 * Les déclarations `via: "effect"` ne concernent pas le porteur de l'item mais les créatures qui portent
 * un effet de l'item (declarationsOfEffects) : `all` les rend quand même, pour la validation.
 */
export function declarationsOfItem(item, { all=false }={}) {
  const list = contentOf(item).entry?.triggers ?? [];
  if ( !list.length ) return [];
  const activities = Array.from(item.system?.activities ?? []);
  const reaction = activities.find(a => a.activation?.type === "reaction") ?? activities[0];
  return list.map(d => normalize(d, {
    item: item.uuid, name: item.name, img: item.img,
    identifier: identifierOf(item).id,
    activity: reaction?.uuid ?? null
  })).filter(d => all || (d.via === null));
}

/** Ce que tous les items d'un acteur déclarent (pour lui-même). */
export function declarationsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) out.push(...declarationsOfItem(item));
  return out;
}


/**
 * Ce que les effets portés par un acteur déclarent (SPEC §16, brique « sauvegarde répétée ») : les
 * déclarations `via: "effect"` de l'item d'où vient chaque effet actif, avec l'effet et l'activité qui
 * l'a posé (`system.origin.activity`, plateau d'effets de dnd5e 6).
 */
export function declarationsOfEffects(actor) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    // L'effet de CONCENTRATION du lanceur vient du même item : il ne porte pas la règle de la cible. Vu en jeu le
    // 2026-09-24 : le Magicien « rejouait » la sauvegarde d'Immobilisation de personne à la fin de son tour, la
    // réussissait, et sa concentration tombait — avec le Paralysé du Zombi.
    if ( effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration") ) continue;
    const item = originItemOf(effect);
    if ( !item ) continue;
    for ( const d of declarationsOfItem(item, { all: true }) ) {
      if ( d.via !== "effect" ) continue;
      if ( d.fromEffect && !comesFromItemEffect(effect, d.fromEffect) ) continue;
      out.push({ ...d, effect: effect.uuid, activity: effect.system?.origin?.activity ?? d.activity, source: item.actor?.uuid ?? null });
    }
  }
  return out;
}

/**
 * Les marques qu'un jet d'attaque consomme (SPEC §16.12, B10) : parmi les effets portés par la cible et par l'attaquant,
 * ceux dont une déclaration `preAttackRoll` tient pour ce jet et porte une étape `consume` du bon côté — `target`
 * pour une marque de la cible (Rayon traçant), `source` pour une marque de l'attaquant (Moquerie cruelle).
 * @returns {Array<{effect: string, name: string, side: "target"|"source", bearer: string}>}  Uuids des effets à retirer.
 */
export function consumedMarks(sourceToken, targetToken, activity) {
  const source = sourceToken?.actor ?? null;
  const target = targetToken?.actor ?? null;
  if ( !source || !target ) return [];
  const facts = factsFor({ source, target, activity, sourceToken, targetToken });
  const out = [];
  for ( const [side, bearer] of [["target", target], ["source", source]] ) {
    for ( const d of select(declarationsOfEffects(bearer), "preAttackRoll", facts) ) {
      if ( !stepsOf(d, "consume").some(s => s.side === side) ) continue;
      if ( !out.some(o => o.effect === d.effect) ) out.push({ effect: d.effect, name: d.name, side, bearer: bearer.name });
    }
  }
  return out;
}

/**
 * Avantage et désavantage que le contenu déclare pour UNE attaque (SPEC §16, B6 : moment `preAttackRoll`) :
 * les items de l'attaquant (Tactique de meute), et les effets portés par l'attaquant comme par la cible
 * (`via: "effect"` : Lueurs féeriques sur la cible, Protection contre le mal et le bien sur la cible) — la
 * condition de chaque déclaration dit de quel côté elle regarde (`target.hasEffect`, `source.hasEffect`).
 * Par nom d'item, sans doublon ; c'est `attackModifiers` (core/conditions.mjs) qui en fait des raisons.
 * @param {TokenDocument} sourceToken
 * @param {TokenDocument} targetToken
 * @param {Activity} activity
 * @returns {{advantage: string[], disadvantage: string[]}}
 */
/**
 * §16.46 : les formules que les déclarations ajoutent au jet d'attaque (`attackBonus` : Voile défensif, « -1d4 »), avec le nom
 * de ce qui les donne.
 * @returns {Array<{name: string, formula: string}>}
 */
export function declaredAttackBonuses(sourceToken, targetToken, activity) {
  const source = sourceToken?.actor ?? null;
  const target = targetToken?.actor ?? null;
  if ( !source || !target ) return [];
  const declarations = [...declarationsOf(source), ...declarationsOfEffects(source), ...declarationsOfEffects(target)];
  const facts = factsFor({ source, target, activity, sourceToken, targetToken });
  const out = [];
  for ( const d of select(declarations, "preAttackRoll", facts) ) {
    for ( const step of stepsOf(d, "attackBonus") ) out.push({ name: d.name, formula: step.formula });
  }
  return out;
}

export function declaredAttackModifiers(sourceToken, targetToken, activity) {
  const source = sourceToken?.actor ?? null;
  const target = targetToken?.actor ?? null;
  const out = { advantage: [], disadvantage: [] };
  if ( !source || !target ) return out;
  const declarations = [...declarationsOf(source), ...declarationsOfEffects(source), ...declarationsOfEffects(target)];
  const facts = factsFor({ source, target, activity, sourceToken, targetToken });
  for ( const d of select(declarations, "preAttackRoll", facts) ) {
    for ( const type of ["advantage", "disadvantage"] ) {
      if ( stepsOf(d, type).length && !out[type].includes(d.name) ) out[type].push(d.name);
    }
  }
  // §19.6 : une réaction jouée « avec l'avantage » (Riposte), marquée sur ce client juste avant son jet.
  const promised = activity?.uuid && hasReactionAdvantage(activity.uuid) ? takeReactionAdvantage(activity.uuid) : null;
  if ( promised && !out.advantage.includes(promised) ) out.advantage.push(promised);
  // §21 : les marques des bottes d'arme — Sape (Désavantage de l'attaquant), Coup vexant (Avantage contre cette cible).
  const marks = markModifiers(sourceToken, targetToken, activity);
  for ( const type of ["advantage", "disadvantage"] ) for ( const name of marks[type] ) if ( !out[type].includes(name) ) out[type].push(name);
  return out;
}

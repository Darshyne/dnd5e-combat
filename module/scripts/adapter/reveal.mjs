/**
 * « Ne peut pas bénéficier de l'état Invisible » (SPEC §16.36, clé `revealsInvisible` : Poussière d'étoile, Lueurs
 * féeriques), jusque dans l'affichage. Le cœur V14 efface un token Invisible pour ceux qui ne le détectent pas, dès que
 * l'état est sur l'acteur ; le moteur, lui, ne patche pas les modes de détection. Tant que la créature est révélée, ses
 * effets qui donnent Invisible (sort d'Invisibilité, se cacher, état coché) sont donc **suspendus** — désactivés, marqués
 * `flags["dnd5e-combat"].veiled` — et réactivés quand la dernière révélation tombe. Le sort d'Invisibilité et sa
 * concentration continuent : c'est son bénéfice qui est suspendu, comme le dit la règle.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

const INVISIBLE = "invisible";
const statusesIn = effect => effect?.statuses instanceof Set ? effect.statuses : new Set(effect?.statuses ?? []);

/** Un effet qui donne l'état Invisible ? */
export function grantsInvisible(effect) {
  return statusesIn(effect).has(INVISIBLE);
}

/** Un effet qui révèle son porteur (venu d'un item `revealsInvisible`) ? */
export function isRevealEffect(effect) {
  const item = originItemOf(effect);
  return !!item && (contentOf(item).entry?.revealsInvisible === true);
}

/** L'acteur porte-t-il une révélation active (hors `except`) ? */
export function isRevealed(actor, except=null) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( (effect === except) || effect.disabled || effect.isSuppressed ) continue;
    if ( isRevealEffect(effect) ) return true;
  }
  return false;
}

/**
 * À la création d'un effet (`preCreateActiveEffect`, sur le client qui l'écrit) : un effet qui rend Invisible une créature
 * révélée naît suspendu. Rend true s'il l'a été.
 */
export function veilOnCreate(effect) {
  const actor = effect.parent;
  if ( (actor?.documentName !== "Actor") || effect.disabled || !grantsInvisible(effect) || !isRevealed(actor) ) return false;
  effect.updateSource({ disabled: true, [`flags.${MODULE_ID}.veiled`]: true });
  return true;
}

/** Une révélation arrive : les effets d'Invisibilité déjà là sont suspendus. MJ actif. Rend leur nombre. */
export async function veilExisting(actor) {
  const updates = (actor?.effects ?? []).filter(e => !e.disabled && grantsInvisible(e) && !isRevealEffect(e))
    .map(e => ({ _id: e.id, disabled: true, [`flags.${MODULE_ID}.veiled`]: true }));
  if ( updates.length ) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
  return updates.length;
}

/** La dernière révélation tombe (`gone` : l'effet qui part) : les effets suspendus reprennent. MJ actif. Rend leur nombre. */
export async function unveil(actor, gone=null) {
  if ( !actor || isRevealed(actor, gone) ) return 0;
  const updates = (actor.effects ?? []).filter(e => e.getFlag(MODULE_ID, "veiled"))
    .map(e => ({ _id: e.id, disabled: false, [`flags.${MODULE_ID}.veiled`]: false }));
  if ( updates.length ) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
  return updates.length;
}

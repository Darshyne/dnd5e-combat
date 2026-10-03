/**
 * §53 : les potions (consommables `type.value === "potion"`, Guide du maître et Manuel des joueurs).
 *
 * Une potion « donne l'effet d'un sort » par une activité « cast » : dnd5e crée une copie du sort sur l'acteur, marquée
 * `flags.dnd5e.cachedFor` (uuid relatif de l'activité d'incantation, activity/cast.mjs), puis l'utilise. Boire n'est pas lancer
 * un sort : ni Contresort, ni rage, ni composante verbale, ni concentration (« no Concentration required », Guide du maître) —
 * et l'effet est pour le buveur.
 *
 * La potion est le plus souvent détruite en étant bue (dépense de son unique utilisation) AVANT que la copie du sort soit créée :
 * on ne peut pas la relire ensuite. D'où la marque posée sur la copie à sa création (`flags.dnd5e-combat.fromPotion`), d'après
 * l'incantation notée quand la potion existait encore (`notePotionCast`, au `dnd5e.preUseActivity` de son activité « cast »).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";

/** Est-ce une potion ? */
export const isPotion = item => (item?.type === "consumable") && (item.system?.type?.value === "potion");

/** « idItem.idActivité » d'un `cachedFor`, ou null. */
function castKey(cachedFor) {
  const m = (typeof cachedFor === "string") ? cachedFor.match(/Item.([A-Za-z0-9]{16}).Activity.([A-Za-z0-9]{16})$/) : null;
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Incantations de potions en cours : clé → { identifier, name } de la potion. */
const pending = new Map();

/** L'activité « cast » d'une potion va être utilisée : on retient la potion, la copie du sort naîtra après sa destruction. */
export function notePotionCast(activity) {
  if ( (activity?.type !== "cast") || !isPotion(activity.item) ) return false;
  pending.set(`${activity.item.id}.${activity.id}`, { identifier: activity.item.system.identifier ?? null, name: activity.item.name });
  return true;
}

/** `preCreateItem` d'une copie de sort : si elle vient d'une potion notée, elle en porte la marque. */
export function stampCachedSpell(item, data) {
  const from = pending.get(castKey(data?.flags?.dnd5e?.cachedFor ?? item?.flags?.dnd5e?.cachedFor));
  if ( !from ) return false;
  item.updateSource({ [`flags.${MODULE_ID}.fromPotion`]: from });
  return true;
}

/**
 * La potion qui a lancé cette copie de sort — `{ identifier, name }` (la marque, ou la potion encore sur la fiche) —, ou null.
 */
export function potionOfCast(item) {
  const stamped = item?.flags?.[MODULE_ID]?.fromPotion;
  if ( stamped ) return stamped;
  const key = castKey(item?.flags?.dnd5e?.cachedFor);
  if ( !key ) return null;
  const source = item.actor?.items?.get(key.split(".")[0]) ?? null;
  if ( isPotion(source) ) return { identifier: source.system.identifier ?? null, name: source.name };
  return pending.get(key) ?? null;
}

/** L'utilisation vient-elle d'une potion (la potion elle-même, ou le sort qu'elle a lancé) ? */
export const fromPotion = item => isPotion(item) || !!potionOfCast(item);

/**
 * `preCreateActiveEffect` : un effet d'item que le contenu complète (`effectChanges` — Vol, Escalade : « une vitesse de vol / d'escalade
 * égale à votre Vitesse », que les données du Guide ne donnent pas). `@walk` : la vitesse au sol du porteur, lue à la pose.
 * Rend le nombre de changements ajoutés.
 */
export function completeEffectChanges(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return 0;
  const rules = contentOf(originItemOf(effect)).entry?.effectChanges;
  const key = rules ? Object.keys(rules).find(id => comesFromItemEffect(effect, id)) : null;
  if ( !key ) return 0;
  const current = effect._source.system?.changes ?? [];
  const walk = actor.system?.attributes?.movement?.walk ?? 0;
  const added = rules[key].filter(c => !current.some(x => x.key === c.key))
    .map(c => ({ key: c.key, type: c.type, value: String(c.value === "@walk" ? walk : c.value) }));
  if ( added.length ) effect.updateSource({ "system.changes": [...current, ...added] });
  return added.length;
}

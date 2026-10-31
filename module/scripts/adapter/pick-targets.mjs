/**
 * §293 : « chaque créature de votre choix dans un rayon de… » (Renvoi des morts-vivants) — ce que le contenu déclare (`pickTargets`) et
 * les créatures que la liste propose : à portée du lanceur (distance 3D du moteur, unité convertie), sur son plan, vivantes, pas des
 * objets, et que la règle de l'activité peut affecter (`targets` : les morts-vivants seuls — la légalité ne redemande rien).
 * L'activité qui peut la remplacer (`upgrade` : Calcination des morts-vivants), si le lanceur a l'item.
 */

import { contentOf, identifierOf } from "./content.mjs";
import { distanceBetween, usageTokenOf } from "./turn.mjs";
import { lengthIn } from "./units.mjs";
import { isObjectToken } from "./bodies.mjs";
import { isDefeated } from "./movement.mjs";
import { samePlane } from "./plane.mjs";
import { areEnemies } from "./factions.mjs";
import { excludedByRule } from "./eligibility.mjs";

/**
 * Les cibles d'un message d'utilisation, comme dnd5e les écrit (`TargetsField.getDescriptors`, data/chat-message/fields/targets-field.mjs:32).
 * Le message d'une utilisation suspendue (la fenêtre de choix) les a déjà prises, vides : la relance les pose elle-même.
 */
export function targetDescriptorsOf(tokens) {
  const own = globalThis.dnd5e?.dataModels?.chatMessage?.fields?.TargetsField?.getDescriptors;
  if ( typeof own === "function" ) return own.call(dnd5e.dataModels.chatMessage.fields.TargetsField, tokens);
  return tokens.filter(t => t.actor).map(t => ({ actor: t.actor.uuid, ac: t.actor.statuses?.has("coverTotal") ? null : (t.actor.system.attributes?.ac?.value ?? null),
    img: t.texture?.src, name: t.name, token: t.uuid }));
}

/** La règle de l'activité, ou null. */
export function pickTargetsOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.pickTargets : null;
  return (rule && rule.activities?.includes(activity.id)) ? rule : null;
}

/** L'activité qui peut remplacer celle-ci (`upgrade`), sur un item du même acteur, ou null. */
export function upgradeOf(activity, rule=pickTargetsOf(activity)) {
  const wanted = rule?.upgrade;
  if ( !wanted || !activity?.actor ) return null;
  const item = activity.actor.items.find(i => identifierOf(i).id === wanted.item);
  return item?.system?.activities?.get?.(wanted.activity) ?? null;
}

/**
 * Les créatures que la liste propose, les plus proches d'abord.
 * @param {Activity} activity
 * @param {object} [options]
 * @param {(token: TokenDocument) => boolean} [options.seen]  Ce que l'utilisateur voit (l'interface le passe) ; par défaut, tout.
 * @returns {{caster: TokenDocument|null, radius: number, units: string, creatures: Array<{token: TokenDocument, distance: number, enemy: boolean}>}}
 */
export function pickCandidates(activity, { seen=() => true }={}) {
  const rule = pickTargetsOf(activity);
  const caster = usageTokenOf(activity);
  if ( !rule || !caster?.parent ) return { caster: caster ?? null, radius: 0, units: "", creatures: [] };
  const units = caster.parent.grid.units;
  const radius = lengthIn(rule.radius, rule.units, units);
  const creatures = [];
  for ( const token of caster.parent.tokens ) {
    if ( (token === caster) || !token.actor || token.hidden || isObjectToken(token) || isDefeated(token) ) continue;
    if ( !samePlane(caster, token) || !seen(token) || excludedByRule(activity, token) ) continue;
    const distance = distanceBetween(caster, token).value;
    if ( distance > radius + 1e-6 ) continue;
    creatures.push({ token, distance, enemy: areEnemies(caster, token) });
  }
  creatures.sort((a, b) => (a.distance - b.distance) || a.token.name.localeCompare(b.token.name));
  return { caster, radius, units, creatures };
}

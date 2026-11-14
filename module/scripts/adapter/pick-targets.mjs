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
import { levelHidden } from "./level-gate.mjs";

/** En sang : à la moitié de ses PV maximum ou moins (et pas à 0 : Survivance ne relève personne). */
const isBloodied = actor => { const hp = actor?.system?.attributes?.hp ?? {}; const max = hp.effectiveMax ?? hp.max ?? 0;
  return (max > 0) && (hp.value > 0) && (hp.value <= max / 2); };

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

/**
 * L'activité qui peut remplacer celle-ci (`upgrade`), sur un item du même acteur, ou null. §431 : une liste est lue dans l'ordre (la
 * Calcination du Manuel et du SRD de dnd5e 6.0, puis celle du SRD 6.1, portée par le Conduit divin) ; `requires`, un item que le
 * lanceur doit avoir en plus ; jamais l'activité elle-même (« Sear Undead » 6.1 utilisée directement). §438 : jamais une activité cachée à
 * ce niveau par la donnée (« Sear Undead » du Manuel 3.0.0, visible au niveau 5 du Clerc : dnd5e refuserait de l'utiliser).
 */
export function upgradeOf(activity, rule=pickTargetsOf(activity)) {
  if ( !rule?.upgrade || !activity?.actor ) return null;
  const items = Array.from(activity.actor.items);
  const has = id => items.some(i => identifierOf(i).id === id);
  for ( const wanted of [rule.upgrade].flat() ) {
    if ( wanted.requires && !has(wanted.requires) ) continue;
    const found = items.find(i => (identifierOf(i).id === wanted.item) && i.system?.activities?.get?.(wanted.activity))
      ?.system.activities.get(wanted.activity);
    if ( found && (found !== activity) && (found.id !== activity.id) && !levelHidden(found) ) return found;
  }
  return null;
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
  // §300 : un rayon en formule (échelle de classe) se lit dans les données de jet de l'activité.
  const raw = (typeof rule.radius === "string")
    ? (Number(globalThis.dnd5e?.utils?.simplifyBonus?.(rule.radius, activity.getRollData?.() ?? {})) || 0) : rule.radius;
  const radius = lengthIn(raw, rule.units, units);
  const creatures = [];
  for ( const token of caster.parent.tokens ) {
    // §296 : `self` — le lanceur aussi (Lueur d'espoir, Survivance : « vous compris »).
    if ( ((token === caster) && !rule.self) || !token.actor || token.hidden || isObjectToken(token) || isDefeated(token) ) continue;
    if ( !samePlane(caster, token) || !seen(token) || excludedByRule(activity, token) ) continue;
    // §296 : `filter: "bloodied"` — seulement les créatures En sang, à la moitié de leurs PV ou moins (Survivance).
    if ( (rule.filter === "bloodied") && !isBloodied(token.actor) ) continue;
    const distance = (token === caster) ? 0 : distanceBetween(caster, token).value;
    if ( distance > radius + 1e-6 ) continue;
    const enemy = (token !== caster) && areEnemies(caster, token);
    creatures.push({ token, distance, enemy, checked: (rule.check === "allies") ? !enemy : enemy });
  }
  creatures.sort((a, b) => (a.distance - b.distance) || a.token.name.localeCompare(b.token.name));
  // §296 : `max` — « une créature de votre choix », « jusqu'à six » : pas plus de cochées d'avance que permis.
  let left = Number.isInteger(rule.max) ? rule.max : Infinity;
  for ( const c of creatures ) if ( c.checked ) { if ( left > 0 ) left--; else c.checked = false; }
  return { caster, radius, units, creatures, max: Number.isInteger(rule.max) ? rule.max : null };
}

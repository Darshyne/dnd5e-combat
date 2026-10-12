/**
 * Qui une action peut affecter (SPEC §16.8), lu dans Foundry pour le cœur (core/eligibility.mjs) : le type de la
 * créature (`system.details.type.value`), ses immunités aux états (`system.traits.ci.value`), les états des effets
 * de l'action (`getEffect()`, dnd5e 6 : un effet peut être une référence de compendium), et ce que le contenu
 * déclare (`targets.types`, `targets.unaffectedIf`).
 */

import { MODULE_ID } from "../constants.mjs";
import { typeAllowed, immuneToAll } from "../core/eligibility.mjs";
import { holds } from "../core/triggers.mjs";
import { contentOf } from "./content.mjs";
import { factsFor, creatureTypeOf, conditionImmunitiesOf, originItemOf } from "./facts.mjs";
import { distanceBetween } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { convertLength } from "../core/units.mjs";
import { isSpellCast } from "./scrolls.mjs";

/**
 * §161 : Globe d'invulnérabilité — « un sort de niveau 5 ou moins lancé de l'extérieur ne peut affecter quoi que ce soit dans
 * l'Émanation » (contenu `globe: { radius, units, maxLevel }`, tenu par un effet du lanceur du globe, concentration comprise). Rend le
 * globe qui protège la cible de ce sort, ou null. `castLevel` : le niveau auquel le sort est lancé.
 */
function globeAgainst(activity, token, castLevel) {
  if ( !isSpellCast(activity?.item) || !token?.parent ) return null;
  const caster = activity.actor?.getActiveTokens?.(false, true)?.find(t => t.parent === token.parent) ?? null;
  const factors = readUnitFactors();
  for ( const holder of token.parent.tokens ) {
    for ( const effect of holder.actor?.effects ?? [] ) {
      if ( effect.disabled || effect.isSuppressed ) continue;
      const item = originItemOf(effect);
      const rule = item ? contentOf(item).entry?.globe : null;
      if ( !rule || (castLevel > rule.maxLevel) ) continue;
      let radius = rule.radius;
      try { radius = convertLength(rule.radius, rule.units, token.parent.grid.units, factors); } catch { /* unité de la grille */ }
      const inside = t => !!t && (distanceBetween(holder, t).value <= radius + 1e-6);
      // §163 : `everywhere` (Champ antimagie) — d'où que vienne le sort.
      if ( inside(token) && (rule.everywhere || !inside(caster)) ) return item;
    }
  }
  return null;
}

const effectKey = e => e._id ?? e.uuid;

/** Ce que le contenu dit des cibles de cette activité (`targets`), ou null. */
export function targetRuleOf(activity) {
  return activity?.item ? (contentOf(activity.item).entry?.targets ?? null) : null;
}

/** Les types permis, si la créature n'en est pas ; sinon null. */
export function wrongTypeFor(activity, actor) {
  const types = targetRuleOf(activity)?.types;
  return typeAllowed(types, creatureTypeOf(actor)) ? null : types;
}

/** « un humanoïde », « une bête ou un humanoïde » : les types en clair, par les libellés de dnd5e. */
export function typesLabel(types) {
  return (types ?? []).map(t => game.i18n.localize(CONFIG.DND5E.creatureTypes?.[t]?.label ?? t).toLowerCase())
    .join(` ${game.i18n.localize("DND5ECOMBAT.Ou")} `);
}

/** Les états d'un effet du plan (`{ id, activity }`, core/action.mjs). */
async function statusesOfRef(ref) {
  const activity = await fromUuid(ref.activity ?? "");
  const profile = activity?.effects?.find(e => effectKey(e) === ref.id);
  const effect = await profile?.getEffect?.();
  return Array.from(effect?.statuses ?? []);
}

/**
 * Pourquoi l'action ne peut pas affecter la créature de ce token, ou null : type interdit, règle du contenu, ou
 * immunité à chacun de ses effets quand elle ne fait rien d'autre (core/eligibility.mjs, `immuneToAll`).
 * @returns {Promise<{reason: "type"|"content"|"immune", detail?: string}|null>}
 */
export async function unaffectedBy(activity, plan, token, { castLevel=null }={}) {
  const actor = token?.actor;
  if ( !actor || !activity ) return null;
  const globe = globeAgainst(activity, token, castLevel ?? Number(activity.item?.system?.level ?? 0));
  if ( globe ) return { reason: "globe", detail: globe.name };
  const rule = targetRuleOf(activity);
  const types = wrongTypeFor(activity, actor);
  if ( types ) return { reason: "type", detail: types.join(",") };
  if ( rule?.unaffectedIf && holds(rule.unaffectedIf, factsFor({ source: activity.actor ?? null, target: actor, activity, targetToken: token })) ) {
    return { reason: "content" };
  }
  const effects = [];
  for ( const ref of plan.effects ?? [] ) effects.push(await statusesOfRef(ref));
  const immune = immuneToAll({ damage: !!plan.damage || !!plan.heal, steps: (plan.steps?.length ?? 0) > 0, effects }, conditionImmunitiesOf(actor));
  return immune ? { reason: "immune", detail: immune } : null;
}

/** Un effet que la créature ne peut pas recevoir (immunité à l'un de ses états) : ses états bloqués, sinon vide. */
export function blockedFor(effect, actor) {
  const immune = conditionImmunitiesOf(actor);
  const blocked = Array.from(effect?.statuses ?? []).filter(s => immune.includes(s));
  if ( blocked.length ) console.log(`${MODULE_ID} | "${effect.name}" not applied to ${actor.name}: immunity (${blocked.join(", ")})`);
  return blocked;
}

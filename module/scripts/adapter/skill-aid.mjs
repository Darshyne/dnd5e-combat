/**
 * §113 : ce que les créatures de la scène peuvent apporter au test de compétence ou d'outil d'un acteur — Assistance (le sort
 * `guidance`, lancé pour de bon par son lanceur), Inspiration bardique (donnée par un barde allié) et Soutien (Avantage). La règle est dans core/skill-aid.mjs ; ici, la lecture
 * des fiches et des tokens.
 */

import { AID_REACH, GUIDANCE_REACH, skillAids } from "../core/skill-aid.mjs";
import { INCAPACITATING, verbalSpellBlocked } from "../core/conditions.mjs";
import { isWithinRange } from "../core/units.mjs";
import { identifierOf } from "./content.mjs";
import { originItemOf, tokenOf } from "./facts.mjs";
import { combatantFor, distanceBetween, rangeOf } from "./turn.mjs";
import { inspirationOf, inspirationSourceOf } from "./inspiration.mjs";
import { isObjectToken } from "./bodies.mjs";
import { readUnitFactors } from "./units.mjs";

export const GUIDANCE = "guidance";

/** Portée de l'Inspiration bardique quand la donnée n'en dit rien de mesurable : 18 m (règles 2024). */
const INSPIRATION_REACH = Object.freeze({ value: 60, units: "ft" });

/** La portée de l'activité d'Inspiration du barde, convertible ; à défaut 18 m. */
function inspirationReach(activity, factors) {
  const r = activity ? rangeOf(activity) : null;
  return ((Number(r?.value) > 0) && Number.isFinite(factors[r.units])) ? { value: Number(r.value), units: r.units } : INSPIRATION_REACH;
}

/** Le sort Assistance de la fiche, ou null. Un parchemin ne compte pas : il s'use, on ne le propose pas d'office. */
export function guidanceSpellOf(actor) {
  return actor?.items?.find(i => (i.type === "spell") && (identifierOf(i).id === GUIDANCE) && (identifierOf(i).from !== "scroll")) ?? null;
}

/** L'activité du sort qui pose l'effet d'une compétence (l'utilitaire de dnd5e porte ses 18 effets), et l'id de cet effet. */
export function guidanceEffectFor(spell, skill) {
  for ( const activity of spell?.system?.activities ?? [] ) {
    for ( const { _id } of activity.effects ?? [] ) {
      const effect = spell.effects.get(_id);
      const changes = effect?.system?.changes ?? effect?.changes ?? [];
      if ( changes.some(c => String(c.key ?? "").startsWith(`system.skills.${skill}.`)) ) return { activity, effectId: _id };
    }
  }
  return null;
}

/** L'acteur a-t-il déjà une Assistance sur cette compétence ? */
export function isGuided(actor, skill) {
  return Array.from(actor?.appliedEffects ?? []).some(effect => {
    if ( effect.disabled || effect.isSuppressed ) return false;
    const item = originItemOf(effect);
    if ( !item || (identifierOf(item).id !== GUIDANCE) ) return false;
    return (effect.system?.changes ?? effect.changes ?? []).some(c => String(c.key ?? "").startsWith(`system.skills.${skill}.`));
  });
}

const statusesOf = actor => Array.from(actor?.statuses ?? []);
const proficientIn = (actor, { skill, tool }) => skill ? (Number(actor?.system?.skills?.[skill]?.value) >= 1)
  : (Number(actor?.system?.tools?.[tool]?.value) >= 1);

/**
 * Les aides possibles au test de `actor`, avec de quoi les proposer.
 * @param {Actor} actor
 * @param {{skill?: string|null, tool?: string|null}} test
 * @returns {Array<{kind: "guidance"|"inspiration"|"help", helper: Actor, token: TokenDocument, self: boolean, tester: TokenDocument,
 *   formula?: string}>}  `formula` : le dé d'une Inspiration bardique.
 */
export function aidsFor(actor, { skill=null, tool=null }={}) {
  const token = tokenOf(actor);
  const scene = token?.parent;
  if ( !token || !scene || (!skill && !tool) ) return [];
  const factors = readUnitFactors();
  const reachOf = (other, reach) => {
    if ( other === token ) return true;
    try { return isWithinRange(distanceBetween(token, other), reach, factors); }
    catch { return false; }
  };
  const tokens = scene.tokens.filter(t => t.actor && !isObjectToken(t) && ((t === token) || (t.disposition === token.disposition)));
  const byId = new Map(tokens.map(t => [t.id, t]));
  const sources = new Map(tokens.map(t => [t.id, inspirationSourceOf(t.actor)]));
  const candidates = tokens.map(t => {
    const statuses = statusesOf(t.actor);
    const source = sources.get(t.id);
    return {
      id: t.id, self: t === token, inReach: reachOf(t, AID_REACH), inGuidanceReach: reachOf(t, GUIDANCE_REACH),
      able: !INCAPACITATING.some(s => statuses.includes(s)),
      knowsGuidance: !!guidanceSpellOf(t.actor),
      canCast: !verbalSpellBlocked(statuses, { spell: true, verbal: true }),
      proficient: proficientIn(t.actor, { skill, tool }),
      inspires: !!source, inInspirationReach: !!source && reachOf(t, inspirationReach(source.activity, factors))
    };
  });
  const aids = skillAids({ skill, tool, inCombat: !!combatantFor(actor), guided: !!skill && isGuided(actor, skill),
    inspired: !!inspirationOf(actor), candidates });
  return aids.map(a => {
    const t = byId.get(a.helper);
    const formula = (a.kind === "inspiration") ? sources.get(t.id)?.formula : undefined;
    return { kind: a.kind, helper: t.actor, token: t, self: t === token, tester: token, ...(formula ? { formula } : {}) };
  });
}

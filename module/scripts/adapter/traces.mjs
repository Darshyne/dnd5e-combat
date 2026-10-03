/**
 * Trace d'une utilisation (SPEC §16.9) : un sort qui ne pose aucun effet (Armure d'Agathys : des PV temporaires et une
 * riposte) ne laisse rien sur son lanceur, et le moteur ne peut pas savoir qu'il est actif — se fier aux seuls PV
 * temporaires ferait riposter un occultiste Fiélon dont la Bénédiction du Ténébreux vient d'en donner. Le contenu
 * déclare `trace: true` : à l'utilisation, le moteur pose sur le lanceur un effet au nom et à l'image de l'item, pour
 * la durée de l'item, dont l'origine est l'activité — ses déclarations `via: "effect"` s'y accrochent comme à tout
 * effet d'item (adapter/triggers.mjs, `declarationsOfEffects`). Le niveau de lancement est gardé comme le fait le
 * plateau d'effets de dnd5e (`flags.dnd5e.scaling`, `spellLevel` : effect-application.mjs, `_prepareEffectData`).
 * Relancé, le sort remplace sa trace.
 * §16.41 : `trace: { activity, show, attack }` — la trace d'une activité précise, montrée sur le token, qui offre une attaque au
 * menu du clic droit ; celle d'un sort à concentration tombe avec elle.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { concentrationOn } from "./summons.mjs";

/** La règle de trace d'un item, normalisée : `{ activity, show, attack }`, ou null. */
export function traceRuleOf(item) {
  const t = item ? contentOf(item).entry?.trace : null;
  if ( t === true ) return { activity: null, show: false, attack: null };
  return (t && (typeof t === "object")) ? { activity: t.activity ?? null, show: t.show === true, attack: t.attack ?? null } : null;
}

/** La trace active de cet item sur l'acteur, ou null. */
export function traceOn(actor, item) {
  return (actor?.effects ?? []).find(e => (e.getFlag(MODULE_ID, "trace") === item.uuid) && !e.disabled) ?? null;
}

/**
 * §16.41 : les attaques offertes par une trace active (Lame de feu : l'attaque de la lame tant qu'elle est invoquée), pour le
 * menu du clic droit.
 */
export function traceAttacks(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = traceRuleOf(item);
    if ( !rule?.attack || !traceOn(actor, item) ) continue;
    const activity = item.system.activities?.get(rule.attack);
    if ( activity ) out.push(activity);
  }
  return out;
}

/** Secondes par unité de durée de dnd5e (`CONFIG.DND5E.scalarTimePeriods`). */
const SECONDS = Object.freeze({ turn: 6, round: 6, minute: 60, hour: 3600, day: 86400, month: 2592000, year: 31536000 });

/** La durée de l'item en secondes, ou null (instantané, permanent, spécial). */
function durationOf(item) {
  const { value, units } = item.system?.duration ?? {};
  const n = Number(value);
  return (SECONDS[units] && Number.isFinite(n) && (n > 0)) ? n * SECONDS[units] : null;
}

/**
 * Pose la trace d'une utilisation, si le contenu de l'item la demande. MJ actif uniquement.
 * @param {ChatMessage} message  Le message d'utilisation (`type: "usage"`).
 * @returns {Promise<ActiveEffect|null>}
 */
export async function leaveTrace(message) {
  const item = message.getAssociatedItem?.();
  const rule = traceRuleOf(item);
  if ( !rule ) return null;
  const actor = message.getAssociatedActor?.();
  const activity = message.getAssociatedActivity?.();
  if ( !actor || !activity ) return null;
  if ( rule.activity && (activity.id !== rule.activity) ) return null;   // Lame de feu : pas à chaque attaque
  // §16.41 : un sort à concentration — la trace tombe avec elle (runtime/concentration.mjs).
  const concentration = concentrationOn(item);
  const previous = actor.effects.filter(e => e.getFlag(MODULE_ID, "trace") === item.uuid).map(e => e.id);
  if ( previous.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", previous);
  const seconds = durationOf(item);
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name,
    img: item.img,
    origin: activity.uuid,
    system: { origin: { activity: activity.uuid, message: message.uuid } },
    duration: seconds ? { value: seconds, units: "seconds" } : {},
    ...(rule.show ? { showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS } : {}),
    flags: {
      [MODULE_ID]: { trace: item.uuid, ...(concentration ? { traceConcentration: concentration.uuid } : {}) },
      dnd5e: { scaling: message.system?.scaling ?? 0, spellLevel: message.system?.level ?? item.system?.level ?? null }
    }
  }]);
  return effect ?? null;
}

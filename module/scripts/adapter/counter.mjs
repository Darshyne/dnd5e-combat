/**
 * §66 : contresort à la manière de 2014 — ce qui touche à dnd5e : le niveau auquel un sort va être lancé (lu sur sa configuration
 * d'utilisation, avant le lancement), et le test de celui qui contre. La règle elle-même est pure (core/counter.mjs).
 *
 * Vérifié dans dnd5e 6.0 : à `dnd5e.preUseActivity`, `usageConfig` est déjà préparé (activity/mixin.mjs:232 puis :257) —
 * `spell.slot` (clé d'emplacement, par défaut celle du niveau du sort ou du sort lié) et `scaling` ; un sort lancé par une
 * activité « cast » (`flags.dnd5e.cachedFor`) prend le niveau de cette activité (`spell.level`, data/item/spell.mjs:285 et
 * :312, `scalingIncrease`). Le niveau choisi ensuite dans la fenêtre d'utilisation n'est pas connu de la porte (elle passe avant).
 */

import { castLevelOf, counterPlan, counterSucceeds } from "../core/counter.mjs";
import { contentOf } from "./content.mjs";
import { castingAbilityOf, castingCheck } from "./dispel.mjs";

/** Le niveau de lancement d'un sort, d'après sa configuration d'utilisation (`dnd5e.preUseActivity`). */
export function castLevelFor(activity, usageConfig={}) {
  const item = activity?.item;
  const slot = usageConfig?.spell?.slot;
  const spells = item?.actor?.system?.spells ?? {};
  const slotLevel = slot ? (spells[slot]?.level ?? Number(String(slot).replace(/\D/g, ""))) : null;
  return castLevelOf({
    level: item?.system?.level ?? 0,
    scaling: Number(usageConfig?.scaling) || 0,
    slotLevel,
    linkedLevel: item?.system?.linkedActivity?.spell?.level ?? null
  });
}

/**
 * Le contresort que l'item déclare (`counter`), ou null : la Réaction de 2024 (sauvegarde du lanceur) n'en déclare pas.
 * @returns {{level: number}|null}
 */
export function counterOf(item) {
  const counter = contentOf(item)?.entry?.counter;
  if ( !counter ) return null;
  return { level: Number.isInteger(counter.level) ? counter.level : (Number(item?.system?.level) || 0) };
}

/**
 * Chez celui qui contre (ses dés) : le sort lancé au niveau `castLevel` échoue-t-il ? Test de la caractéristique d'incantation de
 * l'item (ou de l'acteur) contre DD 10 + niveau, au-delà du niveau du contresort.
 * @returns {Promise<{castLevel, level, auto, dc, total, ability, dissipated}|null>}
 */
export async function resolveCounter(actor, item, castLevel) {
  const counter = counterOf(item);
  if ( !counter ) return null;
  const plan = counterPlan(castLevel, counter.level);
  const ability = castingAbilityOf(item, actor);
  const total = plan.auto ? null : await castingCheck(actor, ability, plan.dc);
  return { ...plan, ability, total, dissipated: counterSucceeds(plan, total) };
}

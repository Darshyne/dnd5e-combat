/**
 * §211 : Se tenir prêt (Ready, règles 2024) — une action préparée à son tour, jouée plus tard par la Réaction, quand un déclencheur
 * perceptible survient, jusqu'au début de son prochain tour. Fonctions pures : le plan, et ce qui le déclenche.
 *
 * Le plan est rangé dans le budget du tour (`readied`, core/turn.mjs) : remis à neuf au début du tour du combattant, il expire avec lui.
 */

/** Les déclencheurs proposés : un ennemi arrive à portée de l'action préparée, attaque, lance un sort. */
export const READY_TRIGGERS = Object.freeze(["enters", "attacks", "casts"]);

/** Le plan préparé du budget, ou null (`readied: true` sans plan : l'action prise, le déclencheur laissé à la table). */
export function readyPlanOf(budget) {
  const plan = budget?.readied;
  return (plan && (typeof plan === "object") && plan.activity && READY_TRIGGERS.includes(plan.trigger)) ? plan : null;
}

/**
 * Ce qu'a fait une créature déclenche-t-il ce plan ?
 * @param {object} plan
 * @param {{kind: "enters"|"attacks"|"casts", source: string}} event  `source` : l'uuid du token qui a agi.
 * @param {{enemies: boolean, reactionAvailable: boolean, incapacitated?: boolean, sees?: boolean|null}} state
 */
export function readyTriggered(plan, event, state) {
  if ( !plan || !event || (plan.trigger !== event.kind) ) return false;
  if ( plan.target && (plan.target !== event.source) ) return false;
  return !!state?.enemies && !!state.reactionAvailable && !state.incapacitated && (state.sees !== false);
}

/**
 * La portée qui arme le déclencheur « arrive à portée », en unités de longueur de l'activité : l'allonge d'une attaque de corps à
 * corps, la portée normale d'une attaque à distance ou d'un sort ; « contact » vaut 5 ft ; « personnelle », la taille de sa zone
 * (Mains brûlantes : son cône) ; une portée illimitée ou spéciale, null (pas de déclencheur de portée).
 * @param {{melee: boolean, reach?: number|null, range?: {value?: number|null, units?: string}, template?: {size?: number|null, units?: string}}} a
 * @returns {{value: number, units: string}|null}
 */
export function readyReach(a) {
  if ( a.melee ) return { value: Number(a.reach) || 5, units: a.range?.units && !["touch", "self"].includes(a.range.units) ? a.range.units : "ft" };
  const units = a.range?.units ?? "ft";
  if ( units === "touch" ) return { value: 5, units: "ft" };
  if ( units === "self" ) return { value: Number(a.template?.size) || 5, units: a.template?.units || "ft" };
  const value = Number(a.range?.value);
  return (Number.isFinite(value) && (value > 0)) ? { value, units } : null;
}

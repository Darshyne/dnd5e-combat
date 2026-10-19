/**
 * §208 : ce que le saut d'un token peut faire maintenant — d'après sa fiche (Force, Dextérité), son contenu (`jump` : Athlète,
 * Monte-en-l'air, sort *Saut* par son effet, Bottes équipées, Pas du vent), son élan (l'historique de déplacement du cœur, en combat) et
 * le budget du tour (saut fixe déjà pris, distance doublée). Les règles : core/jump.mjs. Longueurs en pieds, sauf mention.
 */
import { RUN_UP, jumpLimits, hasRunningStart } from "../core/jump.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { combatantFor, readBudget, committedPosition } from "./turn.mjs";
import { lengthIn } from "./units.mjs";
import { difficultRegionsFor } from "./path-world.mjs";

/** Un objet qui agit porté : équipé, et lié s'il demande un lien. */
const worn = item => (item.system?.equipped !== false) && ((item.system?.attunement !== "required") || item.system?.attuned === true);

/**
 * Les règles de saut de cet acteur.
 * @returns {{runUp: number, useDex: boolean, fixed: {distance: number, cost: number}|null, double: string[]}}
 */
export function jumpRulesOf(actor) {
  const out = { runUp: RUN_UP, useDex: false, fixed: null, double: [] };
  const take = (rule, { carried }) => {
    if ( !rule ) return;
    if ( Number.isFinite(rule.runUp) ) out.runUp = Math.min(out.runUp, rule.runUp);
    if ( rule.useDex ) out.useDex = true;
    if ( rule.double ) out.double.push(...rule.double);
    const f = rule.fixed;
    // Un saut fixe porté par l'effet d'un sort (Saut) ne vaut que pour la créature qui porte l'effet, pas pour le lanceur.
    if ( f && ((f.from === "effect") ? !carried : carried) && (!out.fixed || (f.distance > out.fixed.distance)) ) {
      out.fixed = { distance: f.distance, cost: f.cost };
    }
  };
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.jump;
    if ( !rule ) continue;
    const physical = ["equipment", "weapon", "consumable", "tool", "loot", "container"].includes(item.type);
    if ( physical && !worn(item) ) continue;
    take(rule, { carried: true });
  }
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item ) take(contentOf(item).entry?.jump, { carried: false });
  }
  return out;
}

/**
 * L'élan : hors combat, toujours (le temps ne compte pas) ; en combat, la marche qui précède le saut, lue dans l'historique de
 * déplacement du tour (`TokenDocument#movementHistory`, vidé au début du tour), doit faire au moins `runUp` pieds.
 */
export function runningStartOf(token, runUp=RUN_UP) {
  if ( !combatantFor(token.actor) ) return true;
  const grid = token.parent?.grid;
  if ( !grid?.size ) return false;
  const points = [...(token.movementHistory ?? []), committedPosition(token)];
  const steps = [];
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1];
    const b = points[i];
    const d = grid.measurePath([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]).distance;
    steps.push({ distance: lengthIn(d, grid.units, "ft"), action: b.action ?? null });
  }
  return hasRunningStart(steps, runUp);
}

/** Ce que permet le saut de ce token, en pieds, et le saut fixe s'il est encore libre ce tour. */
export function jumpOptionsOf(token) {
  const actor = token.actor;
  const rules = jumpRulesOf(actor);
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  const abilities = actor?.system?.abilities ?? {};
  const runningStart = runningStartOf(token, rules.runUp);
  const limits = jumpLimits({ str: abilities.str?.value, dex: abilities.dex?.value, useDex: rules.useDex, runningStart,
    double: !!budget?.jumpDouble });
  return { ...limits, runningStart, fixed: (budget?.fixedJump ? null : rules.fixed), rules, combatant, budget };
}

/** La case d'arrivée est-elle un terrain difficile pour ce token (régions de terrain difficile de dnd5e) ? */
export function landsOnDifficult(token, point, elevation) {
  return difficultRegionsFor(token).some(region => region.testPoint?.({ x: point.x, y: point.y, elevation }));
}

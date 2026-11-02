/**
 * O1 (SPEC §335) : la correction de la donnée premium d'un objet (`dataFixes`, core/data-fixes.mjs) sur un document dnd5e.
 */
import { MODULE_ID } from "../constants.mjs";
import { dataFixPlan, planIsEmpty } from "../core/data-fixes.mjs";
import { contentOf } from "./content.mjs";

/** Le plan de correction d'un item, ou `null` s'il n'y a rien à corriger. */
export function dataFixPlanOf(item) {
  if ( item?.documentName !== "Item" ) return null;
  const fixes = contentOf(item).entry?.dataFixes;
  if ( !fixes ) return null;
  const plan = dataFixPlan(item.toObject(), fixes);
  return planIsEmpty(plan) ? null : plan;
}

/** Applique le plan : champs de l'item, puis effets corrigés, puis effets créés (avec leur id). */
export async function applyDataFixes(item, plan) {
  const options = { [MODULE_ID]: { dataFix: true } };
  if ( Object.keys(plan.item).length ) await item.update(plan.item, options);
  if ( plan.effects.length ) await item.updateEmbeddedDocuments("ActiveEffect", plan.effects, options);
  if ( plan.create.length ) await item.createEmbeddedDocuments("ActiveEffect", plan.create, { ...options, keepId: true });
}

/**
 * §410 (issue #44, lot 3) : ce qui manque à une utilisation — emplacement de sort, utilisations, quantité, préparation (règle pure :
 * core/resources.mjs). dnd5e ne le refuse qu'en dépensant, après `dnd5e.preUseActivity` (`Activity#use`, dnd5e.mjs:17696 ; emplacement
 * :18067 ; utilisations `_usesConsumption` :5016 ; matériaux `consumeMaterial` :4941 ; emplacements consommés `consumeSpellSlots` :4978) :
 * le moteur le juge avant, dans la fenêtre de légalité, et un joueur qui force relance sans rien dépenser (`forced` du §77,
 * runtime/usage.mjs).
 */

import { isShort, plainCost, resourceIssues, slotLeft } from "../core/resources.mjs";
import { ritualModeOf } from "./grimoire.mjs";

/** Le niveau d'un emplacement consommé par une cible « spellSlots » (sa cible, plus la montée par niveau). */
function slotTargetLevel(target, scaling) {
  const base = Number(target.target) || 1;
  return base + ((target.scaling?.mode === "level") ? (Number(scaling) || 0) : 0);
}

/**
 * Les consommations de l'activité que dnd5e dépensera, avec ce qui reste : `{ index, kind, available, cost }`. Sans configuration (case
 * de la barre) : celles que dnd5e dépenserait par défaut (`_prepareUsageConfig`, dnd5e.mjs:17862 : hors combat, pas les « combat seul »).
 */
function spentTargets(activity, usageConfig) {
  const actor = activity.actor;
  const chosen = Array.isArray(usageConfig?.consume?.resources) ? new Set(usageConfig.consume.resources) : null;
  if ( usageConfig?.consume === false ) return [];
  const out = [];
  for ( const [index, target] of Array.from(activity.consumption?.targets ?? []).entries() ) {
    if ( chosen ? !chosen.has(index) : (target.combatOnly && !actor?.inCombat) ) continue;
    const cost = plainCost(target.value);
    if ( target.type === "activityUses" ) out.push({ index, kind: "uses", available: Number(activity.uses?.value) || 0, cost, max: activity.uses?.max });
    else if ( target.type === "itemUses" ) {
      const item = target.target ? actor?.items?.get(target.target) : activity.item;
      if ( item ) out.push({ index, kind: "uses", available: Number(item.system.uses?.value) || 0, cost, max: item.system.uses?.max });
    }
    else if ( target.type === "material" ) {
      const item = actor?.items?.get(target.target);
      if ( item ) out.push({ index, kind: "quantity", available: Number(item.system.quantity) || 0, cost });
    }
    else if ( target.type === "spellSlots" ) {
      const level = slotTargetLevel(target, usageConfig?.scaling);
      out.push({ index, kind: "slot", available: slotLeft(actor?.system?.spells, level) ? 1 : 0, cost: 1 });
    }
  }
  // Une limite sans maximum (« utilisations » vides) ne compte pas.
  return out.filter(t => (t.kind !== "uses") || (Number(t.max) > 0) || (typeof t.max === "string" && t.max !== ""));
}

/**
 * Ce qui manque à cette utilisation. `keys` : les raisons (`noSlot`, `noUses`, `noQuantity`, `unprepared`) ; `skip` : ce qu'un joueur
 * qui force ne dépense pas (`spellSlot`, indexes de `resources`).
 * @param {Activity} activity
 * @param {object|null} [usageConfig]  La configuration d'utilisation, quand on la connaît (`dnd5e.preUseActivity`).
 * @param {{recast?: boolean}} [options]
 * @returns {{keys: string[], skip: {spellSlot: boolean, resources: number[]}}}
 */
export function missingResources(activity, usageConfig=null, { recast=false }={}) {
  const none = { keys: [], skip: { spellSlot: false, resources: [] } };
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !item || !actor || recast ) return none;
  // Un parchemin, une copie de sort lancée par un objet (`cachedFor`) ou une activité liée (`cause`) ne dépensent pas d'emplacement.
  const linked = !!usageConfig?.cause?.activity || !!item.getFlag?.("dnd5e", "cachedFor") || !!item.getFlag?.("dnd5e", "spellLevel");
  const spell = item.type === "spell";
  // Rituel possible (hors combat, §139) : pas d'emplacement nécessaire, la fenêtre du rituel en décide ensuite.
  const ritual = spell && (ritualModeOf(activity) !== "none");
  const needsSlot = spell && !linked && !ritual && !!activity.requiresSpellSlot && !!activity.consumption?.spellSlot
    && (usageConfig?.consume !== false) && (usageConfig?.consume?.spellSlot !== false);
  const level = (Number(item.system.level) || 0) + (Number(usageConfig?.scaling) || 0);
  const left = needsSlot ? slotLeft(actor.system?.spells, level, usageConfig?.spell?.slot ?? null) : true;
  const targets = spentTargets(activity, usageConfig);
  const short = targets.filter(isShort);
  // Préparé : une méthode qui se prépare (CONFIG.DND5E.spellcasting[…].prepares) demande `prepared` ; un rituel non préparé d'un Adepte
  // des rituels passe par le mode rituel.
  const prepares = spell && !linked && !!CONFIG.DND5E?.spellcasting?.[item.system.method]?.prepares;
  // Un sort mineur ne se prépare pas.
  const unprepared = prepares && ((Number(item.system.level) || 0) > 0) && !item.system.prepared && !ritual;
  // Un objet physique épuisé (la dernière javeline lancée, laissée sur la fiche à 0).
  const empty = ["weapon", "consumable", "equipment", "tool"].includes(item.type) && (item.system.quantity !== undefined)
    && (Number(item.system.quantity) <= 0);
  const keys = resourceIssues({
    slotMissing: (needsSlot && !left) || short.some(t => t.kind === "slot"),
    usesShort: short.some(t => t.kind === "uses"),
    quantityShort: empty || short.some(t => t.kind === "quantity"),
    unprepared });
  return { keys, skip: { spellSlot: needsSlot && !left, resources: short.map(t => t.index) } };
}

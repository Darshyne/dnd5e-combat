/**
 * §139 : le grimoire du Magicien, côté Foundry — ce que `core/grimoire.mjs` juge, lu sur l'acteur et le sort.
 *  - Rituel : l'étiquette `ritual` du sort (`system.properties`), `requiresSpellSlot` et `consumption.spellSlot` de l'activité,
 *    `system.method` / `system.prepared` du sort ; Savoir rituel = un item de l'acteur qui déclare `ritualAdept: { class }`.
 *  - Restauration magique : un item qui déclare `slotRecovery: { class, maxLevel }`, ses utilisations (1 / Repos long).
 */

import { contentOf } from "./content.mjs";
import { combatantFor } from "./turn.mjs";
import { ritualMode } from "../core/grimoire.mjs";

/** Le lanceur a-t-il encore un emplacement (ou un emplacement de pacte) du niveau du sort ou plus ? */
export function slotLeft(item) {
  const level = item.system?.level ?? 0;
  return Object.values(item.actor?.system?.spells ?? {}).some(s => (s?.value > 0) && ((s.level ?? 0) >= level));
}

/** Le sort vient-il du grimoire de cette classe ? Sa classe d'origine, ou, sans elle, une classe que l'acteur a. */
function fromClass(item, cls) {
  const source = item.system?.sourceClass;
  return source ? (source === cls) : !!item.actor?.classes?.[cls];
}

/**
 * Comment cette activité se lancerait maintenant : « none », « ritual » (en rituel d'office) ou « ask » (rituel ou emplacement).
 * @param {Activity} activity
 * @returns {"none"|"ritual"|"ask"}
 */
export function ritualModeOf(activity) {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !actor || (item?.type !== "spell") ) return "none";
  const adept = actor.items.some(i => {
    const rule = contentOf(i).entry?.ritualAdept;
    return !!rule && fromClass(item, rule.class);
  });
  return ritualMode({
    ritual: item.system.properties?.has?.("ritual") === true,
    requiresSlot: !!(activity.requiresSpellSlot && activity.consumption?.spellSlot),
    inCombat: !!combatantFor(actor),
    // Préparé : une méthode qui se prépare (CONFIG.DND5E.spellcasting[…].prepares : « spell », « pact ») demande `prepared` ; les
    // autres (inné, à volonté…) sont toujours prêts.
    prepared: !CONFIG.DND5E.spellcasting?.[item.system.method]?.prepares || !!item.system.prepared,
    adept,
    slotLeft: slotLeft(item)
  });
}

/**
 * Restauration magique de l'acteur, si elle peut servir : l'item, sa règle, le niveau de classe, les emplacements par niveau.
 * null sans item, sans utilisation restante.
 * @param {Actor5e} actor
 */
export function slotRecoveryOf(actor) {
  const item = (actor?.items ?? []).find(i => contentOf(i).entry?.slotRecovery);
  if ( !item ) return null;
  const rule = contentOf(item).entry.slotRecovery;
  const uses = item.system.uses;
  if ( (uses?.max > 0) && !(uses.value > 0) ) return null;
  const classLevel = actor.classes?.[rule.class]?.system?.levels ?? 0;
  if ( !classLevel ) return null;
  const slots = {};
  for ( let level = 1; level <= 9; level++ ) {
    const s = actor.system.spells?.[`spell${level}`];
    if ( s?.max ) slots[level] = { value: Number(s.value) || 0, max: Number(s.max) || 0 };
  }
  return { item, rule, classLevel, slots };
}

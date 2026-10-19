/**
 * §211 : Se tenir prêt — ce qu'un acteur peut préparer, les emplacements d'un sort préparé, et l'option de réaction qui libère le plan.
 *
 * Vérifié (dnd5e 6.0, `references/dnd5e-6/src`) :
 *  - un sort préparé se lance à son tour : l'emplacement est dépensé et la créature se concentre dessus jusqu'à le libérer
 *    (`Actor5e#beginConcentrating(activity)`, documents/actor/actor.mjs:1091) ;
 *  - à la libération, `use({ consume: { spellSlot: false }, spell: { slot } })` (documents/activity/mixin.mjs:445-497) lance le sort
 *    sans reprendre d'emplacement, au niveau de celui dépensé.
 */

import { MODULE_ID } from "../constants.mjs";
import { readyReach } from "../core/ready.mjs";

/** Le sort est-il prêt à être lancé (mineur, préparé, de pacte, inné, à volonté) ? */
function castable(item) {
  return ((item.system.level ?? 0) === 0) || !!item.system.prepared || ["pact", "innate", "atwill", "always"].includes(item.system.method);
}

/** Les données de portée d'une activité, pour `readyReach`. */
function reachData(activity) {
  const item = activity.item;
  const melee = (activity.type === "attack") && (activity.attack?.type?.value === "melee");
  return readyReach({
    melee,
    reach: activity.range?.reach ?? item.system.range?.reach ?? 5,
    range: { value: activity.range?.value ?? item.system.range?.value ?? null, units: activity.range?.units ?? item.system.range?.units ?? "ft" },
    template: { size: activity.target?.template?.size ?? null, units: activity.target?.template?.units ?? "ft" }
  });
}

/**
 * Ce qu'un acteur peut préparer : les attaques de ses armes (équipées pour un personnage) et de ses capacités, et les sorts prêts qui
 * se lancent par une action (« un sort dont le temps d'incantation est d'une action »). Une option par activité qui agit.
 * @returns {Array<{activity: string, name: string, img: string, level: number, spell: boolean, reach: {value: number, units: string}|null}>}
 */
export function readyOptionsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const spell = item.type === "spell";
    if ( spell ) {
      if ( !castable(item) || ((item.system.activation?.type ?? "action") !== "action") ) continue;
    } else if ( item.type === "weapon" ) {
      if ( (actor.type === "character") && !item.system.equipped ) continue;
    } else if ( item.type !== "feat" ) continue;
    const activities = [...(item.system.activities ?? [])].filter(a => spell
      ? ["attack", "save", "damage", "heal", "utility", "summon"].includes(a.type) : (a.type === "attack"));
    for ( const activity of activities ) {
      if ( !spell && !["weapon", "unarmed"].includes(activity.attack?.type?.classification) && (item.type === "feat") ) continue;
      const many = activities.length > 1;
      out.push({ activity: activity.uuid, name: many && activity.name ? `${item.name} : ${activity.name}` : item.name, img: item.img,
        level: spell ? (item.system.level ?? 0) : 0, spell, reach: reachData(activity) });
    }
  }
  return out;
}

/** Les emplacements d'où lancer un sort de ce niveau (au moins le sien, non vides), du plus bas au plus haut. */
export function slotsFor(actor, level) {
  const out = [];
  for ( const [key, v] of Object.entries(actor?.system?.spells ?? {}) ) {
    const lvl = (key === "pact") ? Number(v?.level) : Number(key.replace("spell", ""));
    if ( Number.isFinite(lvl) && (lvl >= level) && ((Number(v?.value) || 0) > 0) && ((Number(v?.max) || 0) > 0) ) out.push({ key, level: lvl, value: Number(v.value) });
  }
  return out.sort((a, b) => a.level - b.level);
}

/** Dépense l'emplacement choisi (sort préparé : l'énergie est retenue jusqu'au déclencheur). */
export async function spendSlot(actor, key) {
  const value = Number(actor?.system?.spells?.[key]?.value) || 0;
  if ( value < 1 ) return false;
  await actor.update({ [`system.spells.${key}.value`]: value - 1 });
  return true;
}

/** L'effet de concentration qui retient un sort préparé (posé par `holdSpell`), ou null. */
export function heldEffectOf(actor) {
  return (actor?.effects ?? []).find(e => e.getFlag?.(MODULE_ID, "readied")) ?? null;
}

/**
 * Retient le sort préparé par la Concentration : la concentration en cours cesse (on ne se concentre que sur une chose), puis un effet
 * de concentration au format de dnd5e est posé, marqué (`ActiveEffect5e.createConcentrationEffectData`, documents/active-effect.mjs:921
 * — qu'on ne peut pas appeler ici : il refuse un sort sans Concentration, or c'est la règle de l'action préparée qui l'impose). Il dure
 * jusqu'au début du prochain tour (runtime/ready.mjs le retire) ; dnd5e le compte (`Actor5e#concentration`, l'état `concentrating`) :
 * des dégâts demandent le jet de Constitution. Rend l'effet, ou null.
 */
export async function holdSpell(activity) {
  const actor = activity?.actor;
  const item = activity?.item;
  if ( !actor || !item?.isEmbedded ) return null;
  if ( actor.concentration?.effects?.size ) await actor.endConcentration();
  const status = CONFIG.statusEffects[CONFIG.specialStatusEffects.CONCENTRATING];
  const data = {
    ...status,
    name: `${game.i18n.localize("EFFECT.DND5E.StatusConcentrating")}: ${item.name}`,
    origin: item.uuid,
    statuses: [status.id].concat(status.statuses ?? []),
    system: { type: "concentrating" },
    flags: {
      dnd5e: { activity: { type: activity.type, id: activity.id, uuid: activity.uuid }, item: { type: item.type, id: item.id, uuid: item.uuid },
        spellLevel: item.system.level },
      [MODULE_ID]: { readied: true }
    }
  };
  delete data.id;
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return effect ?? null;
}

/**
 * L'option de réaction qui libère le plan, au format d'`askReaction` : son activité, contre la créature qui a déclenché ; un sort
 * préparé se lance sans emplacement, au niveau dépensé, et son effet de concentration tombe d'abord ; la carte porte `readiedRelease`
 * (le plan est servi : runtime/turn.mjs le retire du budget avec la Réaction).
 */
export function readyOption(plan) {
  return {
    activity: plan.activity, name: plan.name, img: plan.img, consume: true, ready: true,
    usage: plan.slot ? { consume: { spellSlot: false }, spell: { slot: plan.slot } } : null,
    drop: plan.held ? [plan.held] : [],
    flags: { readiedRelease: true },
    template: true
  };
}

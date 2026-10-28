/**
 * §274 : les munitions d'une arme, lues et retenues là où dnd5e les garde (issue #23).
 *  - les munitions possibles : `item.system.ammunitionOptions` (data/item/weapon.mjs:145, consommables « ammo » du sous-type de l'arme) ;
 *  - le choix retenu : `flags.dnd5e.last.<activité>.ammunition`, lu par `rollAttack` (activity/attack.mjs:94) et écrit par lui après
 *    le jet (attack.mjs:205) — écrire là, c'est mettre d'accord la fenêtre de dnd5e, le jet sans dialogue et la chance de toucher.
 */
import { MODULE_ID } from "../constants.mjs";
import { ammoChoice } from "../core/ammo.mjs";

/** L'arme tire-t-elle des munitions ? */
export function usesAmmo(item) {
  return (item?.type === "weapon") && (item.system.properties?.has?.("amm") === true) && !!item.actor;
}

/** Les activités d'attaque d'une arme (une seule en général). */
function attackActivities(item) {
  return Array.from(item?.system.activities?.values?.() ?? []).filter(a => a.type === "attack");
}

/**
 * Les munitions qu'une arme peut tirer et celle que son prochain jet tirerait.
 * @param {Item5e} item
 * @param {Activity} [activity]   L'activité d'attaque (la première de l'arme par défaut).
 * @param {object} [options]
 * @param {string|null} [options.explicit]  Une munition imposée.
 * @returns {{options: Array<{id, name, img, quantity}>, current: string|null, ask: boolean}|null}  null : l'arme ne tire rien.
 */
export function ammoState(item, activity=null, { explicit=null }={}) {
  if ( !usesAmmo(item) ) return null;
  activity ??= attackActivities(item)[0] ?? null;
  const options = (item.system.ammunitionOptions ?? []).map(o => ({
    id: o.value, name: o.item?.name ?? o.label, img: o.item?.img ?? null, quantity: Number(o.item?.system.quantity ?? 0)
  }));
  const remembered = activity ? (item.getFlag("dnd5e", `last.${activity.id}.ammunition`) ?? null) : null;
  const choice = ammoChoice({ options, remembered, explicit });
  return { options, current: choice.use, ask: choice.ask };
}

/**
 * Retient une munition pour les prochaines attaques de l'arme (toutes ses activités d'attaque), et l'annonce
 * (hook `dnd5e-combat.ammunition`, `(item, ammoId)`, sur chaque client par la mise à jour de l'item).
 * @param {Item5e} item
 * @param {string} ammoId   L'id d'un consommable de munition de la créature.
 * @returns {Promise<boolean>}  false : l'arme ne tire pas cette munition, ou l'item n'est pas modifiable.
 */
export async function setAmmo(item, ammoId) {
  if ( !usesAmmo(item) || !item.isOwner ) return false;
  if ( !(item.system.ammunitionOptions ?? []).some(o => o.value === ammoId) ) return false;
  const update = {};
  for ( const a of attackActivities(item) ) update[`flags.dnd5e.last.${a.id}.ammunition`] = ammoId;
  if ( foundry.utils.isEmpty(update) ) return false;
  await item.update(update, { [MODULE_ID]: { ammunition: ammoId } });
  return true;
}

/** `updateItem` : un changement de munition retenue, d'où qu'il vienne (DAS, fenêtre de dnd5e après le jet) → hook public. */
export function announceAmmoChange(item, changes) {
  const last = changes?.flags?.dnd5e?.last;
  if ( !last || !usesAmmo(item) ) return;
  const changed = Object.values(last).some(v => v && (typeof v === "object") && ("ammunition" in v));
  if ( !changed ) return;
  Hooks.callAll(`${MODULE_ID}.ammunition`, item, ammoState(item)?.current ?? null);
}

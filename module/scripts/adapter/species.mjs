/**
 * Traits d'espèce du Manuel des joueurs 2024 (SPEC §31) qui touchent aux PV : Acharnement (Orc, contenu `endurance`) — « si vous
 * tombez à 0 point de vie sans être tué sur le coup, vous pouvez en fait vous retrouver à 1 point de vie ; une fois par Repos
 * long » (les utilisations de l'item).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";

/** L'item d'Acharnement de l'acteur, s'il lui reste une utilisation ; sinon null. */
export function enduranceOf(actor) {
  const item = (actor?.items ?? []).find(i => contentOf(i).entry?.endurance === true);
  if ( !item ) return null;
  const uses = item.system.uses ?? {};
  const left = Number.isFinite(Number(uses.value)) ? Number(uses.value) : (Number(uses.max) || 0) - (Number(uses.spent) || 0);
  return (left > 0) ? item : null;
}

/**
 * `dnd5e.preApplyDamage`, avant le calcul des échecs à 0 PV : des dégâts qui font tomber la créature à 0 PV sans la tuer sur le
 * coup (le reste des dégâts au-delà de 0 est inférieur à son maximum de PV) la laissent à 1 PV ; l'utilisation est dépensée.
 * Rend l'item utilisé, ou null. `through` : les dégâts qui passent les PV temporaires.
 */
export function endureAtZero(actor, through, updates) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !(hp.value > 0) || (through < hp.value) ) return null;
  if ( (through - hp.value) >= (hp.max ?? Infinity) ) return null;   // tué sur le coup
  const item = enduranceOf(actor);
  if ( !item ) return null;
  updates["system.attributes.hp.value"] = 1;
  item.update({ "system.uses.spent": (Number(item.system.uses.spent) || 0) + 1 })
    .catch(err => console.warn(`${MODULE_ID} | ${item.name} : utilisation non dépensée`, err));
  return item;
}

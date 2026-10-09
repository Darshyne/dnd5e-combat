/**
 * Ordre imposé (SPEC §16.59) : l'effet qui porte l'ordre sur la cible, et « Lâche » — ce que la créature tient : ses armes
 * et son bouclier équipés. Qui les pose au sol : un module voisin qui s'est proposé au hook `dnd5e-combat.dropItems`
 * (§40.3 — le moteur n'en connaît aucun) : ils tombent en tas à ses pieds et quittent sa fiche ; sans voisin, ils sont
 * seulement déséquipés (restés dans l'inventaire : « lâchés », à ramasser d'une action d'Utilisation d'un objet). Le repli
 * sur Item Piles a été retiré au §44.
 */

import { MODULE_ID } from "../constants.mjs";

/** L'ordre qu'un acteur doit suivre : `{ effect, order, from }` (from : uuid du token du lanceur), ou null. */
export function orderOn(actor) {
  for ( const effect of actor?.effects ?? [] ) {
    const flag = effect.getFlag?.(MODULE_ID, "order");
    if ( flag?.order && !effect.disabled ) return { effect, order: flag.order, from: flag.from ?? null, done: flag.done === true };
  }
  return null;
}

/** L'effet qui porte l'ordre, à créer sur la cible. Il cesse à la fin de son prochain tour (contenu : `remove` à endOfTurn). */
export function orderEffectData({ item, activity, order, label, fromToken, message }) {
  return {
    name: game.i18n.format("DND5ECOMBAT.LabelValue", { label: item.name, value: label }),
    img: item.img,
    origin: item.uuid,
    system: { origin: { item: item.uuid, activity: activity?.uuid ?? null, message: message?.uuid ?? null } },
    flags: { [MODULE_ID]: { order: { order, from: fromToken ?? null } } }
  };
}

/** Ce que la créature tient : armes et bouclier équipés — pas les armes naturelles (Coup, Morsure : type « natural »). */
export function heldItemsOf(actor) {
  return (actor?.items ?? []).filter(i => (i.system?.equipped === true)
    && (((i.type === "weapon") && (i.system.type?.value !== "natural")) || ((i.type === "equipment") && (i.system.type?.value === "shield"))));
}

/**
 * §40.3 : un module voisin pose au sol ce qu'une créature lâche (Darsh Loot : un tas dans sa case). Le moteur appelle
 * `Hooks.callAll("dnd5e-combat.dropItems", takers, { token, items })` chez le MJ actif ; un module qui s'en charge pousse
 * dans `takers` une fonction `async () => boolean` — vrai : les objets ont quitté la fiche et sont au sol. La première qui
 * répond vrai l'emporte ; une erreur ou un refus laisse la suite (le simple déséquipement) faire. Sert aussi au familier qui
 * part dans sa poche dimensionnelle (§107).
 */
export async function droppedByNeighbour(token, items) {
  const takers = [];
  Hooks.callAll(`${MODULE_ID}.dropItems`, takers, { token, items });
  for ( const take of takers ) {
    if ( typeof take !== "function" ) continue;
    try { if ( (await take()) === true ) return true; }
    catch(err) { console.warn(`${MODULE_ID} | dropped items: a neighbouring module failed`, err); }
  }
  return false;
}

/**
 * Lâche ce que la créature tient. Rend `{ items: [noms], pile: boolean }`.
 * @param {TokenDocument} token
 */
export async function dropHeld(token) {
  const actor = token?.actor;
  const held = heldItemsOf(actor);
  if ( !held.length ) return { items: [], pile: false };
  const names = held.map(i => i.name);
  if ( await droppedByNeighbour(token, held) ) return { items: names, pile: true };
  await actor.updateEmbeddedDocuments("Item", held.map(i => ({ _id: i.id, "system.equipped": false })));
  return { items: names, pile: false };
}

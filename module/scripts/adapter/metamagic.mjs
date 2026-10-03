/**
 * Métamagie de l'Ensorceleur (SPEC §32). Chaque option du Manuel des joueurs 2024 est un item dont l'activité dépense les points de
 * Sorcellerie (dnd5e le fait) ; rien, dans le système, ne modifie ensuite le sort. Le moteur retient l'option choisie sur
 * l'acteur (`flags["dnd5e-combat"].metamagic`), la reporte sur la carte du sort suivant (`flags["dnd5e-combat"].metamagic`,
 * liste de genres), puis l'oublie.
 *
 * Genres tenus par le moteur : « quickened » (le sort d'une action se lance par une action Bonus), « careful » (des alliés
 * réussissent d'office leur sauvegarde, sans dégâts s'ils en auraient subi la moitié), « heightened » (une cible a le Désavantage
 * à sa sauvegarde), « distant » (portée doublée ; contact → 9 m), « subtle » (sans composante : pas de Contresort possible).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";

/** Le genre de Métamagie de cette activité (contenu `metamagic: { activity, kind }`), ou null. */
export function metamagicKindOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.metamagic : null;
  return (rule && (rule.activity === activity.id)) ? rule.kind : null;
}

/** Les options retenues pour le prochain sort de l'acteur (au plus une minute). */
export function pendingMetamagic(actor) {
  const flag = actor?.getFlag?.(MODULE_ID, "metamagic");
  if ( !flag?.kinds?.length ) return [];
  const now = game.time?.worldTime ?? 0;
  return (Number.isFinite(flag.at) && ((now - flag.at) > 60)) ? [] : flag.kinds;
}

export async function addMetamagic(actor, kind) {
  const kinds = [...new Set([...pendingMetamagic(actor), kind])];
  await actor.setFlag(MODULE_ID, "metamagic", { kinds, at: game.time?.worldTime ?? 0 });
  return kinds;
}

export async function clearMetamagic(actor) {
  if ( actor?.getFlag?.(MODULE_ID, "metamagic") ) await actor.unsetFlag(MODULE_ID, "metamagic");
}

/** Les options portées par la carte d'un sort. */
export const usageMetamagic = message => message?.getFlag?.(MODULE_ID, "metamagic") ?? [];

/** Sort ample : la portée d'un sort, doublée ; « contact » (ou moins de 1,50 m) devient 9 m. */
export function distantRange(range) {
  if ( !range ) return range;
  if ( (range.units === "touch") || !(Number(range.value) > 0) ) return { ...range, value: 30, units: "ft" };
  return { ...range, value: Number(range.value) * 2, long: range.long ? Number(range.long) * 2 : range.long };
}

/**
 * §438 : la porte de niveau d'une activité, lue sur l'activité de dnd5e (pur : core/level-gate.mjs).
 */

import { hiddenAtLevel } from "../core/level-gate.mjs";

/**
 * §438 : une activité cachée à ce niveau par la donnée (`visibility.level` ; dnd5e 6.1.0 `isHidden`, dnd5e.mjs:18844-18853 —
 * `relevantLevel` : le niveau de la classe nommée, sinon celui du personnage). Le Manuel des joueurs 3.0.0 range les versions
 * améliorées d'une aptitude comme des activités du même item, l'une visible jusqu'à un niveau, l'autre à partir du suivant (Éclat
 * protecteur, Déluge de coups « Heightened ») : le contenu les nomme toutes, seule celle du niveau est proposée. Rien d'autre de
 * `isHidden` n'est repris (un item masqué sur la fiche garde ses réactions).
 */
export function levelHidden(activity) {
  const range = activity?.visibility?.level;
  if ( !range || ((range.min == null) && (range.max == null)) ) return false;
  let level;
  try { level = Number(activity.relevantLevel); } catch { return false; }
  return hiddenAtLevel(range, level);
}

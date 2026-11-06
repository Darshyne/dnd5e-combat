/**
 * #33 : l'aperçu de l'abri avant une attaque — ce que la pastille au curseur affiche (ui/hitchance.mjs) et ce que publie
 * `api.ui.cover`. Le calcul est celui du verdict (`coverFor`, `coverAgainst`) ; trois différences, toutes d'affichage :
 *  - « Dégagé » est un résultat (degré « none »), pas un silence ;
 *  - un état d'abri posé à la main (`coverHalf`…) est rendu comme tel, source « manual » (le verdict l'a déjà dans la CA) ;
 *  - un abri ignoré (Tireur d'élite…) est rendu avec ce qui l'ignore.
 * Côté joueur, seules les créatures que ce client voit comptent (`seenOnly`) : l'aperçu ne trahit pas une créature invisible
 * ou cachée. Il peut alors différer du verdict, qui reste la vérité (calculé par le MJ actif). Le MJ voit tout.
 */

import { COVER } from "../core/cover.mjs";
import { coverFor, manualCoverOf, canJudgeCover } from "./cover.mjs";
import { coverIgnoredBy } from "./conditions.mjs";

/**
 * @typedef {object} CoverPreview
 * @property {"none"|"half"|"threeQuarters"|"total"} degree
 * @property {number|null} bonus        Bonus à la CA ; null : abri total (intouchable).
 * @property {string[]} sources         « wall », « surface », « creature », « zone », « grapple », « manual ».
 * @property {string|null} zone         Le nom du sort qui donne l'abri, quand la source est « zone ».
 * @property {boolean} manual           L'abri vient d'un état posé à la main.
 * @property {{degree: string, by: string}|null} ignored  Un abri que cette attaque ignore, et ce qui l'ignore.
 */

/**
 * L'abri de `target` contre une attaque de `attacker` avec `activity`, tel que ce client peut le montrer ; null hors attaque ou
 * quand le canevas ne peut pas en juger (autre scène, redessin).
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {object} [options.posA]        Position de l'attaquant au bout de son approche.
 * @param {string} [options.attackMode]
 * @returns {CoverPreview|null}
 */
export function coverPreviewOf(attacker, target, activity, { posA, attackMode=null }={}) {
  if ( (activity?.type !== "attack") || !attacker?.parent || (attacker.parent !== target?.parent) ) return null;
  if ( !canJudgeCover(attacker.parent) ) return null;
  const base = { degree: "none", bonus: 0, sources: [], zone: null, manual: false, ignored: null };
  const manual = manualCoverOf(target);
  if ( manual ) return { ...base, degree: manual, bonus: COVER[manual].bonus, sources: ["manual"], manual: true };
  const cover = coverFor(attacker, target, { posA, quiet: true, activity, attackMode, seenOnly: !game.user?.isGM });
  if ( !cover ) return base;
  const by = (cover.degree !== "total") ? coverIgnoredBy(attacker, target, activity, attackMode) : null;
  if ( by ) return { ...base, ignored: { degree: cover.degree, by } };
  return { ...base, degree: cover.degree, bonus: cover.bonus, sources: cover.sources, zone: cover.zone };
}

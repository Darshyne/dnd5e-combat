/**
 * §113 : les aides proposées à un test de compétence ou d'outil, à la manière de BG3 — règles 2024.
 *  - Assistance (`guidance`, tour de magie, contact, concentration) : « vous touchez une créature consentante et choisissez une
 *    compétence ; jusqu'à la fin du sort, elle ajoute 1d4 à tout test de caractéristique utilisant cette compétence ». Le testeur
 *    lui-même s'il connaît le sort, ou un allié au contact — à 7,50 m hors combat (`GUIDANCE_REACH`). Pas pour un test d'outil (« une compétence »).
 *  - Soutien (Help), partie test : « choisissez l'une de vos maîtrises de compétence ou d'outil et un allié assez proche pour
 *    l'aider ; il a l'Avantage à son prochain test avec cette compétence ou cet outil ». Un allié, jamais soi-même.
 *  - Inspiration bardique (`bardic-inspiration`, action Bonus, 18 m dans la donnée) : « une autre créature » — un allié barde qui a
 *    encore une utilisation, à portée de l'activité ; pas si le testeur porte déjà une inspiration. Le dé se lance APRÈS le test,
 *    s'il est raté (« quand la créature rate un Test d20 ») : runtime/roll-bonus.mjs le propose.
 *
 * En combat comme hors combat ; seule la portée d'Assistance change (demande de l'utilisateur, 2026-10-08). Sans dépendance à Foundry.
 */

/** « Assez proche pour aider » (Soutien) : 1,50 m, la case voisine (constante de règle, convertie par l'appelant). */
export const AID_REACH = Object.freeze({ value: 5, units: "ft" });

/**
 * Assistance proposée depuis la fenêtre du test, HORS COMBAT : le contact multiplié par cinq, 7,50 m — souplesse demandée par
 * l'utilisateur (2026-10-08) : l'allié fait les quelques pas pour toucher le testeur. En combat, le contact (`AID_REACH`).
 */
export const GUIDANCE_REACH = Object.freeze({ value: AID_REACH.value * 5, units: AID_REACH.units });

/**
 * @param {object} args
 * @param {string|null} [args.skill]      La compétence testée.
 * @param {string|null} [args.tool]       L'outil testé.
 * @param {boolean} [args.inCombat]       Le testeur est dans un combat commencé.
 * @param {boolean} [args.guided]         Le testeur a déjà une Assistance sur cette compétence.
 * @param {boolean} [args.inspired]       Le testeur porte déjà une Inspiration bardique.
 * @param {Array<{id: string, self?: boolean, inReach: boolean, inGuidanceReach?: boolean, able: boolean, knowsGuidance?: boolean,
 *   canCast?: boolean, proficient?: boolean, inspires?: boolean, inInspirationReach?: boolean}>} [args.candidates]
 *   Le testeur (`self`) et ses alliés : à portée du Soutien (`AID_REACH`) et de l'Assistance (`GUIDANCE_REACH`), capable
 *   d'agir (pas Neutralisé), connaît Assistance, peut lancer un sort à composante verbale, maîtrise la compétence ou l'outil,
 *   peut donner une Inspiration bardique et le testeur est à sa portée.
 * @returns {Array<{kind: "guidance"|"inspiration"|"help", helper: string}>}  Assistance, Inspiration, Soutien ; le testeur en tête.
 */
export function skillAids({ skill=null, tool=null, inCombat=false, guided=false, inspired=false, candidates=[] }={}) {
  if ( !skill && !tool ) return [];
  const guidanceReach = c => (inCombat ? c.inReach : (c.inGuidanceReach ?? c.inReach));
  const ordered = [...candidates.filter(c => c.self), ...candidates.filter(c => !c.self)];
  const out = [];
  if ( skill && !guided ) {
    for ( const c of ordered ) {
      if ( c.knowsGuidance && (c.canCast !== false) && guidanceReach(c) && c.able ) out.push({ kind: "guidance", helper: c.id });
    }
  }
  if ( !inspired ) {
    for ( const c of ordered ) {
      if ( !c.self && c.inspires && c.inInspirationReach && c.able ) out.push({ kind: "inspiration", helper: c.id });
    }
  }
  for ( const c of ordered ) {
    if ( !c.self && c.proficient && c.inReach && c.able ) out.push({ kind: "help", helper: c.id });
  }
  return out;
}

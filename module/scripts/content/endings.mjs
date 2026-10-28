/**
 * §258 : fins génériques (`endsWhen`, core/endings.mjs), par identifiant dnd5e — relevées par l'audit CAT / CPR du 2026-10-28.
 */

const NOBODY = { unaffected: "failedSave" };

export const ENDS_WHEN = Object.freeze({
  // « Le sort prend fin plus tôt si la cible enfile une armure. »
  "mage-armor": { armor: "any" },
  // Rage (PHB 2024) : « elle prend fin plus tôt si vous enfilez une armure lourde ».
  "rage": { armor: "heavy" },
  // Lien de garde : « le sort prend fin si l'un de vous tombe à 0 point de vie, ou si vous êtes séparés de plus de 18 mètres ».
  "warding-bond": { apart: { distance: 60, units: "ft" }, zeroHp: true, spell: true },
  // Duel forcé : « …ou si vous finissez votre tour à plus de 9 mètres de la cible ». Les autres fins (attaquer une autre créature,
  // un allié qui la blesse) restent au MJ.
  "compelled-duel": { apart: { distance: 30, units: "ft", at: "casterTurnEnd" }, spell: true, ...NOBODY },
  // Sorts de concentration qui n'ont d'effet que sur une sauvegarde ratée : si toutes les cibles réussissent, la concentration n'a
  // plus rien à tenir (réglage `endUnaffected`).
  "banishment": NOBODY,
  "bestow-curse": NOBODY,
  "compulsion": NOBODY,
  "confusion": NOBODY,
  "crown-of-madness": NOBODY,
  "dominate-beast": NOBODY,
  "dominate-person": NOBODY,
  "dominate-monster": NOBODY,
  "enlarge-reduce": NOBODY,
  "fear": NOBODY,
  "hideous-laughter": NOBODY,
  "tashas-hideous-laughter": NOBODY,
  "hold-monster": NOBODY,
  "hold-person": NOBODY,
  "hypnotic-pattern": NOBODY,
  "phantasmal-killer": NOBODY,
  "polymorph": NOBODY,
  "slow": NOBODY,
  "sleep": NOBODY
});

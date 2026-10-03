/**
 * L'Ensorceleur du Manuel des joueurs 2024 (SPEC §32), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbscr…`,
 * options de Métamagie `phbmmo…`).
 *
 * Ce que dnd5e fait déjà seul : Réserve arcanique (points et conversions), Résistance draconique, Ailes draconiques, Révélation
 * charnelle, Sorcellerie innée (+1 au DD : l'effet), Restauration ensorcelée, les dépenses de points des options de Métamagie.
 */

/** Une option de Métamagie : son activité retient le genre pour le prochain sort (runtime/metamagic.mjs). */
const meta = (activity, kind) => ({ metamagic: { activity, kind } });

/** Affinité élémentaire : « un type choisi » — celui de la Résistance que l'aptitude a donnée. */
const affinity = type => ({ on: "preDamageRoll", if: { "activity.isSpell": true, "activity.dealsType": type, "source.resists": type },
  do: [{ type: "damage", formula: "@abilities.cha.mod", damageType: type }] });

export const SORCERER = Object.freeze({
  // Sorcellerie innée : « l'Avantage aux jets d'attaque des sorts d'Ensorceleur que vous lancez » (le DD : l'effet de l'item).
  "innate-sorcery": { triggers: [{ on: "preAttackRoll", if: { "source.hasEffect": "innate-sorcery", "activity.classSpell": "sorcerer" },
    do: [{ type: "advantage" }] }] },
  // Métamagie.
  "quickened-spell": meta("leFbHb9SZwDix2TU", "quickened"),
  "careful-spell": meta("jD3THRjOL2ILRYuM", "careful"),
  "heightened-spell": meta("uHwIuPfMDD9sxVa9", "heightened"),
  "distant-spell": meta("WMoNZCe0IyHlRLM4", "distant"),
  "subtle-spell": meta("9jWUnfRzs0TqKWC2", "subtle"),
  // Affinité élémentaire (Draconique 6) : « + votre modificateur de Charisme à un jet de dégâts » d'un sort du type choisi.
  "elemental-affinity": { triggers: ["acid", "cold", "fire", "lightning", "poison"].map(affinity) },
  // Défenses psychiques (Aberrante 6) : Avantage aux sauvegardes contre Charmé et Effrayé.
  "psychic-defenses": { saveAdvantage: ["charmed", "frightened"] }
});

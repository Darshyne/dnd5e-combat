/**
 * Les espèces du Manuel des joueurs 2024 (SPEC §31), module premium `dnd-players-handbook` 2.2.0 (pack `origins`, traits
 * `phbspt…`). Déjà là : Ascendance féerique (§16.25), Saut des nuées (§16.10, content/teleports.mjs).
 *
 * Ce que dnd5e fait déjà seul, par les effets transférés des traits ou les cases « Traits spéciaux » de la feuille : Ruse gnome
 * (Avantage aux sauvegardes d'Int., Sag., Cha.), Chance (relancer un 1, `halflingLucky`), Agilité halfeline, Forte carrure,
 * Ténacité naine, Résistance naine (la résistance au poison), Résistance céleste, Vol draconique, Mains guérisseuses, Transe. Une
 * copie ancienne d'un trait peut avoir perdu son effet : la macro `tools/macros/reparer-effets-phb.js` les recopie du compendium.
 */

/** Ascendance gigante (Goliath) : les faveurs proposées au coup, une utilisation chacune. */
export const SPECIES = Object.freeze({
  // Brave (Halfelin) : « l'Avantage aux jets de sauvegarde visant à éviter l'état Effrayé ou à y mettre fin ».
  "brave": { saveAdvantage: ["frightened"] },
  // Résistance naine : « l'Avantage aux jets de sauvegarde visant à éviter l'état Empoisonné ».
  "dwarven-resilience": { saveAdvantage: ["poisoned"] },
  // Acharnement (Orc) : « si vous tombez à 0 point de vie sans être tué sur le coup, vous pouvez vous retrouver à 1 point de vie ».
  "relentless-endurance": { endurance: true },
  // Poussée d'adrénaline (Orc) : « l'action Pointe par une action Bonus » (les PV temporaires : l'activité de dnd5e).
  "adrenaline-rush": { basicActions: { jN5Zo6mDXll3c4Cz: "dash" } },
  // Souffle (Drakéide) : « vous pouvez remplacer l'une de vos attaques par une expiration » — les deux activités (Cône, Ligne).
  "breath-weapon": { replacesAttack: true },
  // Forme de géant (Goliath 5) : « devenir de taille G » — l'effet de l'activité change la taille (§16.49, `resize`).
  "large-form": { resize: { QI7POclNlvX9a8VD: 1 } },
  // Ascendance gigante (Goliath) — Brûlure ignée : « 1d10 dégâts de feu supplémentaires » ; Froid mordant : « 1d6 de froid, et sa
  // Vitesse réduite de 3 m jusqu'au début de votre tour suivant » ; Renversement des coteaux : « À terre, taille G ou inférieure ».
  "fires-burn": { hitRider: { damage: "002cv19dj8WGzSl2" } },
  "frosts-chill": { hitRider: { damage: "6goWQaWLexUqgig8", effect: "YHKgdj2KIbQRBZWW" }, effectEnds: { YHKgdj2KIbQRBZWW: "casterTurnStart" } },
  "hills-tumble": { hitRider: { status: "prone", sizeAtMost: "lg" } },
  // Endurance de la pierre : « quand vous subissez des dégâts, votre Réaction : 1d12 + votre modificateur de Constitution de moins »
  // — le jet de l'activité (1d12 dans les données) plus la Constitution ; le moteur le propose quand une attaque vous touche.
  "stones-endurance": { triggers: [{ on: "isHit", do: [{ type: "use", activity: "vrWhAQ6Bj4gznxHq" }, { type: "reduce", bonus: "@abilities.con.mod" }] }] },
  // Tonnerre des cieux : « quand vous subissez des dégâts de la part d'une créature dans un rayon de 18 m, votre Réaction : 1d8
  // dégâts de tonnerre à cette créature ».
  "storms-thunder": { triggers: [{ on: "isDamaged", if: { "target.within": { distance: 60, units: "ft" } },
    do: [{ type: "use", activity: "3eWfDnXfYJVJqT1z", target: "source" }] }] },
  // Révélation céleste (Aasimar 3) : pendant la transformation, une fois par tour de l'aasimar, une cible de son attaque ou de son
  // sort subit en plus son bonus de maîtrise en dégâts — radiants (nécrotiques pour
  // le Linceul nécrotique : au joueur).
  "celestial-revelation": { triggers: [{ on: "preDamageRoll", oncePerTurn: true,
    if: { "source.hasEffect": "celestial-revelation", any: [{ "activity.isAttack": true }, { "activity.isSpell": true }] },
    do: [{ type: "damage", formula: "@prof", damageType: "radiant" }] }] }
});

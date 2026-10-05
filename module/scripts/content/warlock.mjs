/**
 * L'Occultiste du Manuel des joueurs 2024 (SPEC §29), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbwlk…`
 * et manifestations `phbinv…`). Déjà là : Pacte de la lame (§16.45), Frappe occulte (§16.19), Lame assoiffée (budget, §16.25),
 * Bénédiction du ténébreux (§16.25), Décharge occulte (rayons, §16.27), Maléfice.
 *
 * Ce que dnd5e fait déjà seul : Décharge déchirante et Lance occulte (enchantements du tour de magie), Vision du diable, Esprit
 * occulte, Vision sorcière, Résistance fiélonne, Bouclier mental (effets), les sorts lancés sans emplacement (activités « cast »),
 * Rouerie magique, Lumière guérisseuse (soin par la réserve de dés).
 */

export const WARLOCK = Object.freeze({
  // Frappe occulte : au plus une fois par tour, un coup de l'arme de pacte peut coûter un emplacement de Magie de pacte pour
  // ajouter des dégâts de force (1d8, plus 1d8 par niveau d'emplacement) et, au choix, renverser une cible de taille TG au plus —
  // proposée au jet de dégâts du coup (§47 bis) ; l'activité
  // « Frappe » de l'item reste là pour un usage à la main (son déclencheur pose À terre, content/triggers.mjs).
  "eldritch-smite": { hitRider: { damage: "CXJlzDUkMYU9w9i9", status: "prone", sizeAtMost: "huge", slot: "pact", weapon: "pact-of-the-blade", oncePerTurn: true } },
  // Décharge répulsive : chaque rayon qui touche une cible de taille G au plus peut l'éloigner de 3 m en ligne droite — le tour
  // de magie porte l'enchantement « Répulsive » ; la poussée, facultative dans la règle, est toujours appliquée.
  "eldritch-blast": { triggers: [{ on: "hit", if: { "activity.enchantedBy": "repelling-blast", "target.sizeAtMost": "lg" },
    do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }] },
  // Buveuse de vie (niveau 9) : au plus une fois par tour, un coup de l'arme de pacte ajoute 1d6, au choix nécrotique, psychique
  // ou radiant — nécrotiques d'office ; le soin par un dé de vie reste au joueur.
  "lifedrinker": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.enchantedBy": "pact-of-the-blade" },
    do: [{ type: "damage", formula: "1d6", damageType: "necrotic" }] }] },
  // Âme radieuse (Céleste 6) : le modificateur de Charisme s'ajoute, une fois par tour, aux dégâts radiants ou de feu d'un sort
  // de l'occultiste.
  "radiant-soul": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.isSpell": true, "activity.dealsType": ["radiant", "fire"] },
    do: [{ type: "damage", formula: "@abilities.cha.mod", damageType: "weapon" }] }] },
  // Défenses envoûtantes (Archifée 10) : touché par un attaquant visible, l'occultiste peut, en Réaction, diviser les dégâts par
  // deux et soumettre l'attaquant à une sauvegarde de Sagesse — l'activité vise l'attaquant.
  "beguiling-defenses": { triggers: [{ on: "isHit", if: { "target.seesSource": true },
    do: [{ type: "use", activity: "Y2cMdoDnGTyEqs0l", target: "source" }, { type: "halve" }] }] },
  // Chance du ténébreux (Fiélon 6) : « quand vous faites un test de caractéristique ou un jet de sauvegarde, ajoutez 1d10 ; après avoir
  // vu le jet, avant ses effets » (§38) — proposé sur une sauvegarde ratée que le moteur lit ; l'activité « Luck » dépense l'utilisation.
  // §92 : Foulée des fées — après chaque Foulée brumeuse, un effet de plus au choix : Foulée revigorante (1d10 PV temporaires, sur
  // soi ; « ou une créature que vous voyez à 3 m » : au MJ) ou Foulée narquoise (Sagesse pour les créatures à 1,50 m de la case
  // quittée, sinon « Narguée » : Désavantage aux attaques contre d'autres que vous, jusqu'au début de votre tour suivant).
  "steps-of-the-fey": {
    afterTeleport: { spells: ["misty-step"], options: [{ activity: "QUbshQXhUDQqlu2s" }, { activity: "48TdRWDqCVcC9mh4", around: "left" }] },
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "sERUxQRn17lzEQbl", if: { "source.hasEffect": "steps-of-the-fey", not: { "source.hasEffectFromTarget": "steps-of-the-fey" } },
      do: [{ type: "disadvantage" }] }]
  },
  // §92 : Échappatoire brumeuse — deux options de plus : Foulée évanescente (Invisible jusqu'au début de votre tour suivant, ou
  // jusqu'à une attaque, des dégâts, un sort : `breaksOn`) et Foulée effroyable (Sagesse ou 2d10 psychiques, à 1,50 m de la case
  // quittée OU d'arrivée, au choix). La Foulée brumeuse par une Réaction aux dégâts : l'activité « cast » de la donnée.
  "misty-escape": {
    afterTeleport: { spells: ["misty-step"], options: [{ activity: "KMyLMOnvFbMuoRYa" }, { activity: "kj8zIhPbjs4UIHtc", around: "left" }, { activity: "kj8zIhPbjs4UIHtc", around: "arrival" }] },
    breaksOn: ["attack", "damage", "spell"],
    saveDamage: { kj8zIhPbjs4UIHtc: "none" }
  },
  "dark-ones-own-luck": { rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["save", "check"] } }
});

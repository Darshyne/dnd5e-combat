/**
 * Le Magicien du Manuel des joueurs 2024 (SPEC §28), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbwzd…`).
 * Déjà là : Égide arcanique et Égide projetée de l'Abjurateur (§16.11, content/absorbs.mjs).
 *
 * Ce que dnd5e fait déjà seul : Restauration magique, Savoir rituel, Érudition, Mémorisation de sort, Maîtrise des sorts et Sorts
 * de prédilection (enchantements « toujours préparé »), Troisième œil (effets), Créatures fantasmagoriques (convocations).
 */

export const WIZARD = Object.freeze({
  // Façonneur de sorts (Évocateur 3) : « désignez jusqu'à 1 + le niveau du sort créatures : elles réussissent automatiquement leur
  // jet de sauvegarde et ne subissent aucun dégât » — le moteur désigne les alliés du lanceur (même disposition).
  "sculpt-spells": { sculptSpells: true },
  // Sort mineur appuyé (Évocateur 6) : « ratez votre jet d'attaque ou la cible réussit son jet de sauvegarde : la moitié des
  // dégâts, mais aucun effet supplémentaire ».
  "potent-cantrip": { potentCantrip: true },
  // Évocation améliorée (Évocateur 10) : « ajoutez votre modificateur d'Intelligence à un jet de dégâts » d'un sort d'Évocation.
  "empowered-evocation": { triggers: [{ on: "preDamageRoll", if: { "activity.isSpell": true, "activity.school": "evo" },
    do: [{ type: "damage", formula: "@abilities.int.mod", damageType: "weapon" }] }] },
  // Calque illusoire (Illusionniste 10) : en Réaction, un jet d'attaque qui touchait le magicien est changé en échec —
  // l'activité « Interposer » (une utilisation par repos court).
  "illusory-self": { triggers: [{ on: "isHit", do: [{ type: "use", activity: "DEHSJ0MTQQkQ99wp" }, { type: "miss" }] }] },
  // Résistance aux sorts (Abjurateur 14) : Avantage aux sauvegardes contre la magie des sorts ; la Résistance aux dégâts des
  // sorts reste au MJ (dnd5e n'a pas de type « dégâts de sort »).
  "spell-resistance": { saveAdvantage: ["magic"] },
  // Égide projetée (Abjurateur 6, `phbwzdProjectedW`) : en Réaction, l'Égide arcanique du magicien prend sur elle les dégâts subis
  // par une créature visible à 9 m ou moins (§38) — l'activité « Project Ward » (réaction, 1 utilisation de l'égide dans les
  // données) est utilisée sans rien consommer : c'est la réserve qui paie, du montant absorbé.
  "projected-ward": { triggers: [{ on: "allyIsDamaged", if: { "target.nearSelf": { distance: 30, units: "ft" }, "self.seesTarget": true },
    do: [{ type: "use", activity: "THaODa86JJaeoWfL", consume: false }, { type: "absorb" }] }] },
  // Présage (Devin 3) : deux d20 tirés à chaque Repos long et gardés en réserve ; chacun peut tenir lieu du résultat d'un Test d20
  // du devin ou d'une créature qu'il voit, choix fait avant le jet, au plus une fois par tour (§36) — le moteur les lance au Repos long et propose de remplacer le jet
  // d'attaque ou la sauvegarde qu'il voit venir. Présage supérieur (Devin 14) : trois d20 ; le plus grand nombre l'emporte.
  "portent": { portent: { dice: 2 } },
  "greater-portent": { portent: { dice: 3 } }
});

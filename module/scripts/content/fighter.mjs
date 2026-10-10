/**
 * Le Guerrier du Manuel des joueurs 2024 (SPEC §21), module premium `dnd-players-handbook` 2.2.0 (packs `classes`, items
 * `phbftr…`, et `feats` pour les styles de combat). Vocabulaire du PHB-fr : Fougue, Second souffle, Décalage tactique, Attaques
 * avisées, Héros du champ d'honneur, styles Armes à deux mains et Armes de jet.
 *
 * Ce que dnd5e fait déjà seul : Second souffle (soin 1d10 + niveau, action Bonus), Attaque supplémentaire (le budget du moteur
 * compte les attaques : adapter/turn.mjs, `attacksPerAction`), Critique amélioré (seuil 19, effet de l'item), styles Archerie,
 * Défense, Duel, Combat en aveugle (effets). Les bottes d'arme : runtime/mastery.mjs.
 */

export const FIGHTER = Object.freeze({
  // §123 : Ralliement (Chevalier du dragon pourpre) — « un allié à 9 m ou moins » ; Interception (style de combat) — « une autre
  // créature à 1,50 m de vous ». « Personnelles » dans les données du Manuel des joueurs.
  "rally": { ranges: { uyAnJsUHU2Aek9Lk: { value: 30, units: "ft" } } },
  "interception": { ranges: { Hjm3PZRt6NdVXiFa: { value: 5, units: "ft" } } },
  // Fougue : « à votre tour, vous pouvez effectuer une action supplémentaire, hors action Magie » ; au niveau 17, deux utilisations
  // mais une seule par tour. L'activité (activation « spéciale ») ne coûte rien au budget ; le moteur y ajoute l'action.
  "action-surge": { grantsAction: true, usageLimits: { jtpVG47zPBUI0CZ5: { oncePerTurn: true } } },
  // Décalage tactique (niveau 5) : « chaque fois que vous activez Second souffle par une action Bonus, vous pouvez vous déplacer
  // jusqu'à la moitié de votre Vitesse sans provoquer d'attaque d'opportunité ».
  "tactical-shift": { movesAfter: "second-wind" },
  // Attaques avisées (niveau 13) : « si vous ratez une créature d'un jet d'attaque, vous avez l'Avantage à votre prochain jet
  // d'attaque contre elle avant la fin de votre prochain tour » — une marque, comme l'Ouverture (runtime/mastery.mjs).
  "studied-attacks": { studiedAttacks: true },
  // Héros du champ d'honneur (Champion 10) : « en combat, vous pouvez vous donner l'Inspiration héroïque chaque fois que vous
  // commencez votre tour sans elle ».
  "heroic-warrior": { heroicWarrior: true },
  // Style Armes à deux mains : « quand vous lancez les dégâts d'une attaque avec une arme de corps à corps tenue à deux mains, vous
  // pouvez considérer tout 1 ou 2 sur un dé de dégâts comme un 3 — l'arme doit avoir la propriété Deux mains ou Polyvalente ».
  "great-weapon-fighting": { greatWeaponFighting: true },
  // Style Armes de jet : +2 aux dégâts d'un coup à distance porté avec une arme de Lancer.
  "thrown-weapon-fighting": { thrownDamage: 2 },

  // §87 : manœuvres du Maître de guerre qui se jouent au toucher — « quand vous touchez une créature d'un jet d'attaque, vous pouvez
  // dépenser un dé de supériorité » : la question des faveurs au jet de dégâts (adapter/smite.mjs, une seule par coup, comme la règle :
  // une manœuvre par attaque), payée par Supériorité martiale (`pays`) ; le dé, de l'activité « Superiority Die » de la manœuvre,
  // au type de dégâts de l'arme ; puis la sauvegarde de la manœuvre sur la cible encore debout, et ce qu'un échec fait.
  // Attaque désarmante : Force ou lâcher un objet (son arme de corps à corps : étape `disarm`).
  "disarming-attack": {
    hitRider: { pays: "combat-superiority", damage: "mlUC7IiS8ZyTvDpZ", save: "5y3EDGj0EGN3xVzO", weaponDamage: true },
    triggers: [{ on: "failedSave", do: [{ type: "disarm" }] }]
  },
  // Attaque distrayante : « le prochain jet d'attaque contre la cible par un autre que vous a l'Avantage, avant le début de votre
  // prochain tour » — l'effet « Distracted » (GrJWQnC7ueEa7U4l), consommé à cette attaque.
  "distracting-strike": {
    hitRider: { pays: "combat-superiority", damage: "DBgCFax1iS3mobyw", effect: "GrJWQnC7ueEa7U4l", weaponDamage: true },
    triggers: [{ on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "distracting-strike", not: { "target.hasEffectFrom": "distracting-strike" } },
      do: [{ type: "advantage" }, { type: "consume", side: "target" }] }]
  },
  // Attaque provocante : Sagesse ou « Désavantage aux jets d'attaque contre une autre cible que vous jusqu'à la fin de votre prochain
  // tour » — l'effet « Goaded » (bJjBbuJ2PZKby1Nt) de la sauvegarde ; sa part de dégâts (le dé, en double) n'est pas lancée.
  "goading-attack": {
    hitRider: { pays: "combat-superiority", damage: "IxCIr1UxK0rqi5De", save: "YZDchvLnuCD6xMkF", weaponDamage: true },
    noDamage: ["YZDchvLnuCD6xMkF"],
    triggers: [{ on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "goading-attack", not: { "source.hasEffectFromTarget": "goading-attack" } },
      do: [{ type: "disadvantage" }] }]
  },
  // Attaque menaçante : Sagesse ou Effrayé jusqu'à la fin de votre prochain tour (effet de la sauvegarde, durée §79).
  "menacing-attack": { hitRider: { pays: "combat-superiority", damage: "DCKmEG3Vy2gvxpKH", save: "b6LpZcPAmrfgo5hc", weaponDamage: true } },
  // Attaque repoussante : une cible de taille G au plus — Force ou repoussée de 4,50 m.
  "pushing-attack": {
    hitRider: { pays: "combat-superiority", damage: "E8n2vBez77Swvt8l", save: "IFAKr2EogbOKzFSk", sizeAtMost: "lg", weaponDamage: true },
    triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }]
  },
  // Croc-en-jambe : une cible de taille G au plus — Force ou À terre.
  "trip-attack": {
    hitRider: { pays: "combat-superiority", damage: "vOstpOszbeITGlUP", save: "EVY5IoXOorEfQbCr", sizeAtMost: "lg", weaponDamage: true },
    triggers: [{ on: "failedSave", do: [{ type: "status", status: "prone" }] }]
  },
  // Attaque manœuvrante : le dé aux dégâts ; « un allié peut se déplacer de la moitié de sa Vitesse par sa Réaction sans provoquer
  // d'attaque d'opportunité de la cible » : au MJ.
  "maneuvering-attack": { hitRider: { pays: "combat-superiority", damage: "y91hZshSUPoqsrpq", weaponDamage: true } },
  // §88 : Parade (manœuvre) — « quand une autre créature vous inflige des dégâts d'un jet d'attaque au corps à corps, votre Réaction et un
  // dé réduisent les dégâts du dé + Force ou Dextérité » : l'activité « soin » (F4UxiihGgkdv4orJ, dé + max(For, Dex), un dé de
  // supériorité) donne le montant retiré, comme la Déviation d'assaut du Moine.
  "parry-maneuver": { triggers: [{ on: "isHit", if: { "activity.isMelee": true }, do: [{ type: "use", activity: "F4UxiihGgkdv4orJ" }, { type: "reduce" }] }] },
  // §88 : Riposte — « quand une créature vous rate d'un jet d'attaque au corps à corps, votre Réaction et un dé : une attaque au corps à
  // corps avec une arme ou à mains nues contre elle ; si vous touchez, le dé s'ajoute aux dégâts » : l'activité « Riposte Damage »
  // (QhxT9ZuZXmHGlrnT) paie le dé et le donne ; l'attaque est celle de l'arme (`weapon`).
  // §89 : manœuvres à l'action Bonus. Fente : Foncer, et le dé promis au prochain coup au corps à corps du tour (« si vous vous
  // déplacez d'au moins 1,50 m en ligne droite juste avant » : non contrôlé) ; l'activité « dégâts » ne lance rien d'elle-même.
  "lunging-attack": { basicActions: { aoTn3UKohm5VAuIT: "dash" }, noDamage: ["aoTn3UKohm5VAuIT"], pendingDie: { activity: "aoTn3UKohm5VAuIT", against: "melee" } },
  // Feinte : une créature à 1,50 m — « l'Avantage à votre prochain jet d'attaque contre elle ce tour-ci ; s'il touche, le dé aux
  // dégâts ». L'activité « dégâts » ne blesse pas : elle pose l'effet « Feinting Attack » (O7ho6H0UL2rg3Mz9) sur la cible, que
  // l'attaque suivante de l'auteur consomme avec l'Avantage ; le dé est promis contre elle.
  "feinting-attack": {
    noDamage: ["Utu8uaZOMepShbyw"],
    pendingDie: { activity: "Utu8uaZOMepShbyw", against: "target" },
    triggers: [{ on: "preAttackRoll", via: "effect", if: { "target.hasEffectFrom": "feinting-attack" }, do: [{ type: "advantage" }, { type: "consume", side: "target" }] }]
  },
  // Jeu de jambes évasif : Se désengager, et le dé de supériorité ajouté à la CA jusqu'au début de votre prochain tour (effet
  // « Evasive AC », vide dans la donnée).
  "evasive-footwork": { basicActions: { d3RqzIKzhqX82OwP: "disengage" }, rolledAc: { activity: "d3RqzIKzhqX82OwP", effect: "rGEvj6OHUjHan8pq" } },
  "riposte": { triggers: [{ on: "isMissed", if: { "activity.isMelee": true }, do: [{ type: "use", target: "source", activity: "QhxT9ZuZXmHGlrnT", weapon: true }] }] },
  // §90 : le reste des manœuvres. Attaque précise — « quand vous ratez un jet d'attaque, ajoutez le dé, ce qui peut le convertir en
  // réussite » : proposé à l'attaque ratée, avant le verdict, comme la Chance du ténébreux l'est à une sauvegarde.
  "precision-attack": { rollBonus: { activity: "WrckriM4bPU6NS38", on: ["attack"] } },
  // Embuscade, Autorité naturelle, Évaluation tactique : le dé ajouté à un test de ces compétences (ou à l'initiative), proposé
  // sitôt le jet lancé. « Sans subir l'état Neutralisé » (Embuscade) : au MJ.
  "ambush": { rollBonus: { activity: "HiargkiZgN4q8kg6", on: ["check", "initiative"], skills: ["ste"] } },
  "commanding-presence": { rollBonus: { activity: "WYWuaoPWf2Vy5olB", on: ["check"], skills: ["itm", "prf", "per"] } },
  "tactical-assessment": { rollBonus: { activity: "qx70O22QGfH0MryE", on: ["check"], skills: ["his", "inv", "ins"] } },
  // Balayage : après un coup au corps à corps, le dé (du type du coup) à une autre créature à 1,50 m de la cible et à l'allonge,
  // si le jet l'aurait touchée — l'activité « dégâts » paie et donne le dé.
  "sweeping-attack": { sweep: { activity: "P9XWzKIH1sEvsOtC" } },
  // Chassé-croisé : échanger sa place avec une créature consentante à 1,50 m (1,50 m de déplacement, sans attaque d'opportunité), puis
  // le dé ajouté à la CA de l'un ou de l'autre jusqu'au début du prochain tour — la donnée porte un effet par valeur du dé (12) : le
  // premier sert de modèle, le total écrit dedans.
  "bait-and-switch": { swapPlaces: { activity: "nYe2l7Rml0qyFbf6" }, rolledAc: { activity: "nYe2l7Rml0qyFbf6", effect: "8HUDgkIN8xvG2BAm", to: "choose" } },
  // Frappe commandée : une attaque de l'action Attaquer cédée à un allié, qui attaque aussitôt avec une arme par sa Réaction, le dé
  // ajouté aux dégâts s'il touche. L'activité « dégâts » ne blesse pas l'allié qu'elle vise.
  "commanders-strike": { replacesAttack: true, noDamage: ["spcp6PQ8947Ds4Qg"], commandStrike: { activity: "spcp6PQ8947Ds4Qg" } }
});

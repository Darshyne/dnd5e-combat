/**
 * Le Barde du Manuel des joueurs 2024 (SPEC §33), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbbrd…`).
 * L'Inspiration bardique elle-même (le dé ajouté à un jet raté par la créature inspirée) est tenue par le moteur hors du contenu :
 * adapter/inspiration.mjs, runtime/engine.mjs.
 *
 * Ce que dnd5e fait déjà seul : l'Inspiration bardique donnée (activité, effet « Inspiré », utilisations), Touche-à-tout, Expertise,
 * Source d'inspiration, Pirouettes éblouissantes (CA, frappe à mains nues), Mante d'inspiration (PV temporaires), Attaque
 * supplémentaire (budget), les sorts toujours préparés des collèges.
 */

export const BARD = Object.freeze({
  // §298 : Attaque supplémentaire (Collège de la vaillance 6) — « un de vos tours de magie d'une action à la place d'une des attaques ».
  "valor-extra-attack": { spellsInAttack: { maxLevel: 0 } },
  // Mots cinglants (Savoir 3) : « quand une créature que vous voyez à 18 m réussit un jet d'attaque, votre Réaction et une
  // Inspiration : lancez le dé et soustrayez le résultat du jet » — proposé quand l'attaque touche le barde ou un allié ; l'attaque
  // est rejugée (le dé vaut autant de CA). Les tests et les jets de dégâts restent au joueur.
  // §301 : « une créature que vous voyez à 18 m » — l'attaquant, vu et à portée du barde (touché lui-même : `target` = le barde).
  "cutting-words": { triggers: [
    { on: "isHit", if: { "target.within": { distance: 60, units: "ft" }, "target.seesSource": true }, do: [{ type: "use" }, { type: "penalty", formula: "@scale.bard.inspiration" }] },
    { on: "allyIsHit", if: { "source.nearSelf": { distance: 60, units: "ft" }, "self.seesSource": true }, do: [{ type: "use" }, { type: "penalty", formula: "@scale.bard.inspiration" }] }
  ] },
  // §301 : Contre-charme (niveau 7) — « vous ratez une sauvegarde contre un effet qui inflige Charmé ou Effrayé : votre Réaction, relancez-la »
  // (proposé sur une sauvegarde ratée pour éviter ou finir l'un de ces états). Simplifications : la relance n'a pas l'Avantage, et une créature
  // à 9 m qui rate la sienne n'est pas couverte.
  "countercharm": { rollBonus: { activity: "dnd5eactivity000", on: ["save"], statuses: ["charmed", "frightened"], reroll: {} } },
  // Esquive cavalière (Danse 14) : l'Esquive totale (§20) ; la partager avec une créature à 1,50 m reste au joueur.
  "leading-evasion": { evasion: true },
  // Inspiration de combat (Vaillance 3) : la créature inspirée par ce barde ajoute le dé aux dégâts d'un coup, ou à sa CA par sa Réaction
  // quand elle est touchée (adapter/inspiration.mjs) — à la place de l'ajouter à un jet raté, qui reste possible.
  "combat-inspiration": { combatInspiration: true },
  // §236 : Inspiration supérieure (niveau 18) — « quand vous jouez l'initiative, vous regagnez des utilisations d'Inspiration bardique
  // jusqu'à en avoir deux ».
  // C12-j : Source d'inspiration (Barde 5) — « vous regagnez toutes vos Inspirations bardiques dépensées après un Repos court ou long ».
  "font-of-inspiration": { regainOnShortRest: ["bardic-inspiration"] },
  "superior-inspiration": { regainOnInitiative: { item: "bardic-inspiration", upTo: 2 } }
});
